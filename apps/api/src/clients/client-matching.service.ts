import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface AnnouncementVectorRow {
  announcement_id: string;
  similarity: number;
  title: string;
  description: string | null;
  search_context: string;
}

interface AnnouncementKeywordRow {
  announcement_id: string;
  keyword_rank: number;
  title: string;
  description: string | null;
  search_context: string;
}

interface TopicMatchRow {
  topic_id: string;
  similarity: number;
  negative_keywords: string[];
}

interface ScoredCandidate {
  announcement_id: string;
  title: string;
  description: string | null;
  search_context: string;
  semantic: number;
  keyword: number;
  hybrid: number;
  rerank: number | null;
  final: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum cosine similarity to include a vector candidate. Lowered slightly
 *  because keyword boost compensates for weaker semantic matches. */
const MATCH_THRESHOLD = 0.22;

/** How many vector candidates to retrieve from pgvector per topic. */
const VECTOR_CANDIDATE_LIMIT = 200;

/** How many keyword-search candidates to retrieve per topic. */
const KEYWORD_MATCH_LIMIT = 100;

/** Maximum final matches stored per topic after scoring. */
const FINAL_MATCH_LIMIT = 100;

/** How many top candidates to send to the LLM re-ranker. */
const RERANK_WINDOW = 25;

/** Used in the reverse direction (announcement → topics). */
const MATCH_LIMIT_TOPICS = 100;

/** Multiplier applied to a match score when a negative keyword is detected. */
const NEGATIVE_KEYWORD_PENALTY = 0.12;

/** Weight of cosine similarity in the hybrid score. */
const SEMANTIC_WEIGHT = 0.65;

/** Weight of normalised keyword rank in the hybrid score. */
const KEYWORD_WEIGHT = 0.35;

/** Blend weights when LLM re-rank score is available. */
const RERANK_HYBRID_WEIGHT = 0.40;
const RERANK_LLM_WEIGHT = 0.60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function applyNegativePenalty(haystack: string, negativeKeywords: string[]): boolean {
  if (negativeKeywords.length === 0) return false;
  const lower = haystack.toLowerCase();
  return negativeKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ClientMatchingService {
  private readonly logger = new Logger(ClientMatchingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
  ) {}

  // ── matchTopic ─────────────────────────────────────────────────────────────

  /**
   * Full pipeline for one topic:
   *   1. Vector search (cosine similarity)
   *   2. Keyword search (tsvector / websearch_to_tsquery on title+description+searchContext)
   *   3. Hybrid score merge (semantic × 0.65 + keyword × 0.35)
   *   4. Negative keyword penalty
   *   5. LLM re-ranking of top RERANK_WINDOW candidates (if OpenAI key present)
   *   6. Upsert ClientMatch rows & remove stale ones
   */
  async matchTopic(topicId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        prompt: string;
        embedding: string | null;
        negative_keywords: string[];
      }>
    >`
      SELECT id, title, prompt, embedding::text, "negativeKeywords" AS negative_keywords
      FROM topics
      WHERE id = ${topicId}::uuid
        AND "embeddingStatus" = 'EMBEDDED'
        AND embedding IS NOT NULL
    `;

    if (!rows.length || !rows[0]?.embedding) {
      this.logger.warn(`Topic ${topicId} not yet embedded, skipping match`);
      return 0;
    }

    const { embedding: vectorStr, title: topicTitle, prompt: topicPrompt } = rows[0];
    const negativeKeywords = (rows[0].negative_keywords ?? []) as string[];

    // 1. Vector candidates
    const vectorRows = await this.prisma.$queryRaw<AnnouncementVectorRow[]>`
      SELECT
        a.id AS announcement_id,
        (1 - (a.embedding <=> ${vectorStr}::vector))::float AS similarity,
        a.title,
        a.description,
        a."searchContext" AS search_context
      FROM announcements a
      WHERE a."embeddingStatus" = 'EMBEDDED'
        AND a.embedding IS NOT NULL
        AND (1 - (a.embedding <=> ${vectorStr}::vector)) >= ${MATCH_THRESHOLD}
      ORDER BY a.embedding <=> ${vectorStr}::vector
      LIMIT ${VECTOR_CANDIDATE_LIMIT}
    `;

    // 2. Keyword candidates (first 400 chars of prompt as free-text query)
    const keywordQuery = topicPrompt.slice(0, 400);
    const keywordRows = await this.runKeywordSearch(keywordQuery, KEYWORD_MATCH_LIMIT);

    // 3. Merge + hybrid score
    const merged = this.mergeAndScore(vectorRows, keywordRows);

    // 4. Negative keyword penalty — use full haystack: title + description + searchContext
    const penalized = merged.map((c) => {
      const haystack = `${c.title} ${c.description ?? ""} ${c.search_context}`.toLowerCase();
      const bad = applyNegativePenalty(haystack, negativeKeywords);
      return bad ? { ...c, hybrid: clamp(c.hybrid * NEGATIVE_KEYWORD_PENALTY) } : c;
    });

    const sorted = penalized.sort((a, b) => b.hybrid - a.hybrid).slice(0, FINAL_MATCH_LIMIT);

    this.logger.log(
      `Topic "${topicTitle}": vector=${vectorRows.length}, keyword=${keywordRows.length}, merged=${merged.length}, pre-rerank=${sorted.length}`,
    );

    // 5. LLM re-ranking of top candidates
    const finalCandidates = await this.applyRerank(topicTitle, topicPrompt, sorted);

    // 6. Upsert
    const retainedIds = new Set<string>();
    for (const c of finalCandidates) {
      retainedIds.add(c.announcement_id);
      await this.prisma.clientMatch.upsert({
        where: { topicId_announcementId: { topicId, announcementId: c.announcement_id } },
        create: { topicId, announcementId: c.announcement_id, similarity: c.final, status: "NEW" },
        update: { similarity: c.final, updatedAt: new Date() },
      });
    }

    if (retainedIds.size > 0) {
      await this.prisma.clientMatch.deleteMany({
        where: { topicId, announcementId: { notIn: Array.from(retainedIds) } },
      });
    } else {
      await this.prisma.clientMatch.deleteMany({ where: { topicId } });
    }

    return finalCandidates.length;
  }

  // ── matchAllTopicsAgainstAnnouncement ──────────────────────────────────────

  /**
   * Called after a new announcement is embedded.
   * Finds all embedded topics that semantically match this announcement.
   * Uses vector similarity only — no LLM (this runs for every scraped announcement).
   */
  async matchAllTopicsAgainstAnnouncement(announcementId: string): Promise<void> {
    const announcements = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        description: string | null;
        search_context: string;
        embedding: string | null;
      }>
    >`
      SELECT id, title, description, "searchContext" AS search_context, embedding::text
      FROM announcements
      WHERE id = ${announcementId}::uuid
        AND "embeddingStatus" = 'EMBEDDED'
        AND embedding IS NOT NULL
    `;

    if (!announcements.length || !announcements[0]?.embedding) {
      this.logger.warn(`Announcement ${announcementId} not yet embedded, skipping topic match`);
      return;
    }

    const ann = announcements[0];
    const announcementVectorStr = ann.embedding;
    const announcementHaystack =
      `${ann.title} ${ann.description ?? ""} ${ann.search_context}`.toLowerCase();

    const matchingTopics = await this.prisma.$queryRaw<TopicMatchRow[]>`
      SELECT
        t.id AS topic_id,
        (1 - (t.embedding <=> ${announcementVectorStr}::vector))::float AS similarity,
        t."negativeKeywords" AS negative_keywords
      FROM topics t
      WHERE t."embeddingStatus" = 'EMBEDDED'
        AND t.embedding IS NOT NULL
        AND (1 - (t.embedding <=> ${announcementVectorStr}::vector)) >= ${MATCH_THRESHOLD}
      ORDER BY t.embedding <=> ${announcementVectorStr}::vector
      LIMIT ${MATCH_LIMIT_TOPICS}
    `;

    if (matchingTopics.length === 0) return;

    this.logger.log(
      `Announcement ${announcementId}: ${matchingTopics.length} topic(s) matched above threshold`,
    );

    for (const topicRow of matchingTopics) {
      const negativeKeywords = (topicRow.negative_keywords ?? []) as string[];
      const isPenalized = applyNegativePenalty(announcementHaystack, negativeKeywords);
      const finalSimilarity = isPenalized
        ? Number(topicRow.similarity) * NEGATIVE_KEYWORD_PENALTY
        : Number(topicRow.similarity);

      await this.prisma.clientMatch.upsert({
        where: {
          topicId_announcementId: { topicId: topicRow.topic_id, announcementId },
        },
        create: {
          topicId: topicRow.topic_id,
          announcementId,
          similarity: finalSimilarity,
          status: "NEW",
        },
        update: { similarity: finalSimilarity, updatedAt: new Date() },
      });
    }
  }

  // ── matchClient ─────────────────────────────────────────────────────────────

  /**
   * Re-match all topics belonging to all projects of a client.
   * Returns the total number of matches found.
   */
  async matchClient(clientId: string): Promise<number> {
    const topics = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t.id
      FROM topics t
      JOIN projects p ON t."projectId" = p.id
      WHERE p."clientId" = ${clientId}::uuid
        AND t."embeddingStatus" = 'EMBEDDED'
    `;

    if (topics.length === 0) {
      this.logger.debug(`No embedded topics found for client ${clientId}`);
      return 0;
    }

    let total = 0;
    for (const topic of topics) {
      total += await this.matchTopic(topic.id);
    }

    this.logger.log(
      `matchClient ${clientId}: ${total} total matches across ${topics.length} topic(s)`,
    );
    return total;
  }

  // ── backfillTopicMatches ───────────────────────────────────────────────────

  /**
   * Re-match all embedded topics (useful after a bulk re-embed of announcements).
   */
  async backfillTopicMatches(): Promise<{ processed: number }> {
    const topics = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM topics WHERE "embeddingStatus" = 'EMBEDDED'
    `;

    this.logger.log(`Backfill: re-matching ${topics.length} embedded topic(s)`);

    for (const topic of topics) {
      await this.matchTopic(topic.id);
    }

    return { processed: topics.length };
  }

  // ── Private: keyword search ────────────────────────────────────────────────

  private async runKeywordSearch(
    query: string,
    limit: number,
  ): Promise<AnnouncementKeywordRow[]> {
    if (!query.trim()) return [];
    try {
      return await this.prisma.$queryRaw<AnnouncementKeywordRow[]>`
        SELECT
          a.id AS announcement_id,
          ts_rank_cd(
            to_tsvector('simple',
              coalesce(a.title, '') || ' ' ||
              coalesce(a.description, '') || ' ' ||
              coalesce(a."searchContext", '')
            ),
            websearch_to_tsquery('simple', ${query})
          )::float AS keyword_rank,
          a.title,
          a.description,
          a."searchContext" AS search_context
        FROM announcements a
        WHERE a."embeddingStatus" = 'EMBEDDED'
          AND to_tsvector('simple',
            coalesce(a.title, '') || ' ' ||
            coalesce(a.description, '') || ' ' ||
            coalesce(a."searchContext", '')
          ) @@ websearch_to_tsquery('simple', ${query})
        ORDER BY keyword_rank DESC
        LIMIT ${limit}
      `;
    } catch (err) {
      this.logger.warn(`Keyword search failed, skipping: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Private: merge & hybrid score ─────────────────────────────────────────

  private mergeAndScore(
    vectorRows: AnnouncementVectorRow[],
    keywordRows: AnnouncementKeywordRow[],
  ): ScoredCandidate[] {
    const map = new Map<string, ScoredCandidate>();

    for (const row of vectorRows) {
      map.set(row.announcement_id, {
        announcement_id: row.announcement_id,
        title: row.title,
        description: row.description,
        search_context: row.search_context,
        semantic: clamp(Number(row.similarity)),
        keyword: 0,
        hybrid: 0,
        rerank: null,
        final: 0,
      });
    }

    // Normalise keyword ranks to [0, 1]
    const maxRank = keywordRows.reduce((m, r) => Math.max(m, Number(r.keyword_rank)), 1) || 1;

    for (const row of keywordRows) {
      const kw = clamp(Number(row.keyword_rank) / maxRank);
      const existing = map.get(row.announcement_id);
      if (existing) {
        map.set(row.announcement_id, { ...existing, keyword: kw });
      } else if (kw >= 0.15) {
        // Keyword-only candidate — include only if the keyword signal is strong enough
        map.set(row.announcement_id, {
          announcement_id: row.announcement_id,
          title: row.title,
          description: row.description,
          search_context: row.search_context,
          semantic: 0,
          keyword: kw,
          hybrid: 0,
          rerank: null,
          final: 0,
        });
      }
    }

    for (const [id, c] of map) {
      map.set(id, {
        ...c,
        hybrid: clamp(c.semantic * SEMANTIC_WEIGHT + c.keyword * KEYWORD_WEIGHT),
      });
    }

    return [...map.values()];
  }

  // ── Private: LLM re-ranking ────────────────────────────────────────────────

  private async applyRerank(
    topicTitle: string,
    topicPrompt: string,
    candidates: ScoredCandidate[],
  ): Promise<ScoredCandidate[]> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey || candidates.length === 0) {
      return candidates.map((c) => ({ ...c, final: c.hybrid }));
    }

    const window = candidates.slice(0, RERANK_WINDOW);
    const rest = candidates.slice(RERANK_WINDOW);

    try {
      const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
      const llm = new ChatOpenAI({
        apiKey,
        model,
        temperature: 0,
        modelKwargs: { response_format: { type: "json_object" } },
      });

      const compact = window.map((c) => ({
        id: c.announcement_id,
        title: c.title,
        context: (c.search_context || c.description || "").slice(0, 250),
      }));

      const result = await llm.invoke([
        [
          "system",
          `Jesteś ekspertem od zamówień publicznych w Polsce. Oceń trafność każdego ogłoszenia przetargowego dla podanego profilu wyszukiwania klienta w skali 0.0-1.0. Bierz pod uwagę: zgodność branżową, rodzaj zamówienia, zakres prac. Odpowiedz WYŁĄCZNIE jako obiekt JSON: {"ranked":[{"id":"...","score":0.0-1.0,"reason":"krótki powód po polsku (max 70 znaków)"}]}`,
        ],
        [
          "human",
          `Profil klienta:\nTemat: ${topicTitle}\n${topicPrompt.slice(0, 500)}\n\nOgłoszenia do oceny:\n${JSON.stringify(compact)}`,
        ],
      ]);

      const parsed = this.parseJson<{
        ranked?: Array<{ id?: string; score?: number; reason?: string }>;
      }>(String(result.content));

      const rerankMap = new Map<string, number>();
      for (const row of parsed.ranked ?? []) {
        if (row.id) rerankMap.set(row.id, clamp(Number(row.score) || 0));
      }

      const rerankWindow = window.map((c) => {
        const rerankScore = rerankMap.get(c.announcement_id) ?? null;
        const final =
          rerankScore != null
            ? clamp(c.hybrid * RERANK_HYBRID_WEIGHT + rerankScore * RERANK_LLM_WEIGHT)
            : c.hybrid;
        return { ...c, rerank: rerankScore, final };
      });

      const restScored = rest.map((c) => ({ ...c, final: c.hybrid }));
      const all = [...rerankWindow, ...restScored].sort((a, b) => b.final - a.final);

      this.logger.log(
        `Re-ranked top ${window.length} candidates with LLM for topic "${topicTitle}"`,
      );
      return all;
    } catch (err) {
      this.logger.warn(
        `LLM re-ranking failed, falling back to hybrid score: ${(err as Error).message}`,
      );
      return candidates.map((c) => ({ ...c, final: c.hybrid }));
    }
  }

  // ── Private: JSON parser ───────────────────────────────────────────────────

  private parseJson<T>(content: string): T {
    try {
      return JSON.parse(content) as T;
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(content.slice(start, end + 1)) as T;
        } catch {
          // fall through
        }
      }
      return {} as T;
    }
  }
}

import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { parseTopicMatchingProfile, type AnnouncementKind, type TopicMatchingProfile } from "@leadfinder/contracts";
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
  kind: AnnouncementKind | null;
}

interface AnnouncementKeywordRow {
  announcement_id: string;
  keyword_rank: number;
  title: string;
  description: string | null;
  search_context: string;
  kind: AnnouncementKind | null;
}

interface TopicMatchRow {
  topic_id: string;
  similarity: number;
  title: string;
  prompt: string;
  negative_keywords: string[];
}

interface TopicCandidate {
  topic_id: string;
  title: string;
  prompt: string;
  negative_keywords: string[];
  semantic: number;
  domain: number;
  hybrid: number;
  rerank: number | null;
  final: number;
}

interface ScoredCandidate {
  announcement_id: string;
  title: string;
  description: string | null;
  search_context: string;
  kind: AnnouncementKind | null;
  semantic: number;
  keyword: number;
  domain: number;
  hybrid: number;
  rerank: number | null;
  final: number;
}

interface TopicMatchingDebugCandidate {
  announcementId: string;
  title: string;
  semantic: number;
  keyword: number;
  domain: number;
  hybrid: number;
  rerank: number | null;
  final: number;
  keptAfterFilters: boolean;
  sentToRerank: boolean;
  keptAfterRerank: boolean;
  negativePenaltyApplied: boolean;
  rejectionReasons: string[];
  rerankReason?: string | null;
  mustHaveSatisfied?: boolean | null;
  excludeTriggered?: boolean | null;
  kindFit?: boolean | null;
  topicCentrality?: "PRIMARY" | "SIGNIFICANT" | "SECONDARY" | "INCIDENTAL" | null;
  scopeType?: "FOCUSED" | "MIXED" | "BUNDLED" | null;
}

interface TopicMatchingDebugReport {
  topicId: string;
  counts: {
    vector: number;
    keyword: number;
    merged: number;
    preRerank: number;
    rerankWindow: number;
    final: number;
  };
  candidates: TopicMatchingDebugCandidate[];
}

interface ResolvedTopicProfile {
  title: string;
  summary: string;
  mustHave: string[];
  niceToHave: string[];
  titleContext: string[];
  exclude: string[];
  expectedKinds: AnnouncementKind[];
  requiredAnchors: string[];
  keywordQuery: string;
  raw: TopicMatchingProfile | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum cosine similarity to include a vector candidate. Lowered slightly
 *  because keyword boost compensates for weaker semantic matches. */
const MATCH_THRESHOLD = 0.35;

/** Stricter threshold for fast announcement -> topic matching path. */
const ANNOUNCEMENT_MATCH_THRESHOLD = 0.4;

/** How many vector candidates to retrieve from pgvector per topic. */
const VECTOR_CANDIDATE_LIMIT = 50;

/** How many keyword-search candidates to retrieve per topic. */
const KEYWORD_MATCH_LIMIT = 100;

/** Maximum final matches stored per topic after scoring. */
const FINAL_MATCH_LIMIT = 100;

/** How many top candidates to send to the LLM re-ranker. */
const RERANK_WINDOW = 50;

/** Used in the reverse direction (announcement → topics). */
const MATCH_LIMIT_TOPICS = 100;

/** Multiplier applied to a match score when a negative keyword is detected. */
const NEGATIVE_KEYWORD_PENALTY = 0.12;

/** Weight of cosine similarity in the hybrid score. */
const SEMANTIC_WEIGHT = 0.5;

/** Weight of normalised keyword rank in the hybrid score. */
const KEYWORD_WEIGHT = 0.2;

/** Blend weights when LLM re-rank score is available. */
const RERANK_HYBRID_WEIGHT = 0.00;
const RERANK_LLM_WEIGHT = 1.00;

/** Domain scoring is disabled from match calculation and filtering. */
const DOMAIN_WEIGHT = 0;

/** Minimum hybrid score required to store a match. */
const MIN_FINAL_SCORE = 0.33;

/** Minimum final score after reranking required to persist a client match. */
const MIN_STORED_MATCH_SCORE = 0.25;

/** Override gates for unusually strong signals. */
const STRONG_SEMANTIC_MATCH = 0.82;
const STRONG_KEYWORD_MATCH = 0.7;

const POLISH_STOPWORDS = new Set([
  "aby",
  "albo",
  "bez",
  "będą",
  "być",
  "była",
  "było",
  "były",
  "celu",
  "czy",
  "dla",
  "do",
  "dotyczące",
  "dotyczy",
  "gdzie",
  "ich",
  "inne",
  "jest",
  "jego",
  "jej",
  "jako",
  "jednak",
  "jeśli",
  "lub",
  "mają",
  "między",
  "musi",
  "nad",
  "nie",
  "oraz",
  "pod",
  "prace",
  "pracy",
  "przedmiot",
  "przez",
  "przy",
  "realizacja",
  "realizacji",
  "się",
  "swoje",
  "także",
  "tam",
  "tego",
  "tej",
  "temat",
  "ten",
  "to",
  "trybie",
  "tym",
  "typu",
  "według",
  "wraz",
  "zakres",
  "zakresie",
  "zamawiający",
  "zapewnienia",
  "ze",
  "został",
]);

const GENERIC_PROCUREMENT_TOKENS = new Set([
  "budowa",
  "budowlane",
  "dostawa",
  "dostawy",
  "dostawę",
  "modernizacja",
  "obsługa",
  "oferta",
  "oferty",
  "postępowanie",
  "postepowanie",
  "przetarg",
  "remont",
  "roboty",
  "serwis",
  "świadczenie",
  "swiadczenie",
  "usługa",
  "usługi",
  "uslug",
  "wdrożenie",
  "wdrozenia",
  "wykonanie",
  "zakup",
  "zamowienia",
  "zamówienia",
  "zamówienie",
]);

const GENERIC_BUSINESS_TOKENS = new Set([
  "benefity",
  "firma",
  "firmy",
  "grupa",
  "grupowa",
  "grupowe",
  "grupowy",
  "klienta",
  "klienta",
  "pakiet",
  "pakiety",
  "personelu",
  "pracownik",
  "pracownika",
  "pracownicy",
  "pracownikow",
  "pracowników",
]);

const PROFILE_FILLER_TOKENS = new Set([
  "cel",
  "celem",
  "dotyczace",
  "dotyczące",
  "elastyczne",
  "interesuja",
  "interesują",
  "kompleksowe",
  "kompleksowych",
  "kompleksowy",
  "konkurencyjne",
  "ktore",
  "które",
  "mozliwosci",
  "możliwości",
  "naszym",
  "obejmuja",
  "obejmują",
  "ofert",
  "poszukuje",
  "poszukujemy",
  "publicznych",
  "roznorodne",
  "różnorodne",
  "szukamy",
  "takze",
  "także",
  "warunki",
  "wsparcia",
  "zajmuje",
  "zarowno",
  "zarówno",
  "zwiazanej",
  "związanej",
]);

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

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function hasTokenMatch(haystack: string, token: string): boolean {
  if (haystack.includes(token)) {
    return true;
  }

  if (token.length >= 7) {
    return haystack.includes(token.slice(0, 6));
  }

  return false;
}

function hasTermMatch(haystack: string, term: string): boolean {
  const normalized = normalizeForMatch(term);
  if (!normalized) return false;
  if (haystack.includes(normalized)) return true;

  const tokens = normalized.match(/[a-z0-9]{3,}/g) ?? [];
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return hasTokenMatch(haystack, tokens[0]);

  return tokens.every((token) => hasTokenMatch(haystack, token));
}

function isSpecificTerm(term: string): boolean {
  const normalized = normalizeForMatch(term);
  if (!normalized || normalized.length < 4) return false;

  return !GENERIC_BUSINESS_TOKENS.has(normalized) && !PROFILE_FILLER_TOKENS.has(normalized);
}

function inferExpectedKinds(text: string): AnnouncementKind[] {
  const normalized = normalizeForMatch(text);
  const inferred = new Set<AnnouncementKind>();

  if (/(ubezpieczen|polis|abonament|opieki medycz|medyczn)/.test(normalized)) {
    inferred.add("USLUGA");
  }

  if (/(szkolen|kurs|warsztat|trening|edukacyjn)/.test(normalized)) {
    inferred.add("SZKOLENIE");
  }

  if (/(doradztw|konsult|audyt)/.test(normalized)) {
    inferred.add("DORADZTWO");
  }

  if (/(badawczo|rozwoj|b\+r|prototyp|laborator)/.test(normalized)) {
    inferred.add("USLUGA_BADAWCZO_ROZWOJOWA");
  }

  if (/(budow|remont|przebudow|rozbudow|termomoderniz|robot)/.test(normalized)) {
    inferred.add("ROBOTY_BUDOWLANE");
  }

  if (/(komputer|laptop|tablet|smartfon|monitor|drukark|skaner|ploter|urzadzen|urządzen|sprzet|sprzęt|wyposazen)/.test(normalized)) {
    inferred.add("DOSTAWA");
  }

  if (/(oprogramowan|system|helpdesk|serwis it|uslug it|usług it|cyber|chmur|licencj)/.test(normalized)) {
    inferred.add(inferred.has("DOSTAWA") ? "DOSTAWA" : "USLUGA_IT");
  }

  return [...inferred];
}

function inferRequiredAnchors(text: string): string[] {
  const normalized = normalizeForMatch(text);
  const anchors = new Set<string>();

  if (/(ubezpieczen|polis)/.test(normalized)) {
    anchors.add("ubezpieczen");
    anchors.add("polis");
  }

  if (/(komputer|laptop|tablet|smartfon|monitor|drukark|skaner|ploter)/.test(normalized)) {
    anchors.add("komputer");
    anchors.add("laptop");
    anchors.add("tablet");
    anchors.add("smartfon");
    anchors.add("monitor");
    anchors.add("drukark");
  }

  if (/(oprogramowan|licencj|system|wdrozen|wdrozen|cyber|helpdesk)/.test(normalized)) {
    anchors.add("oprogramowan");
    anchors.add("licencj");
    anchors.add("system");
  }

  if (/(budow|remont|przebudow|modernizacj)/.test(normalized)) {
    anchors.add("budow");
    anchors.add("remont");
    anchors.add("przebudow");
  }

  return [...anchors];
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
    const debugReport = await this.buildTopicMatchingDebugReport(topicId);

    const finalCandidates = debugReport.candidates
      .filter((candidate) => candidate.keptAfterRerank && candidate.final >= MIN_STORED_MATCH_SCORE);

    // 6. Upsert
    const retainedIds = new Set<string>();
    for (const c of finalCandidates) {
      retainedIds.add(c.announcementId);
      await this.prisma.clientMatch.upsert({
        where: { topicId_announcementId: { topicId, announcementId: c.announcementId } },
        create: { topicId, announcementId: c.announcementId, similarity: c.final, status: "NEW" },
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

  async buildTopicMatchingDebugReport(topicId: string): Promise<TopicMatchingDebugReport> {
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
      return {
        topicId,
        counts: {
          vector: 0,
          keyword: 0,
          merged: 0,
          preRerank: 0,
          rerankWindow: 0,
          final: 0,
        },
        candidates: [],
      };
    }

    const { embedding: vectorStr, title: topicTitle, prompt: topicPrompt } = rows[0];
    const negativeKeywords = (rows[0].negative_keywords ?? []) as string[];
    const profile = this.resolveTopicProfile(topicTitle, topicPrompt, negativeKeywords);

    const vectorRows = await this.prisma.$queryRaw<AnnouncementVectorRow[]>`
      SELECT
        a.id AS announcement_id,
        (1 - (a.embedding <=> ${vectorStr}::vector))::float AS similarity,
        a.title,
        a.description,
        a."searchContext" AS search_context,
        a.kind
      FROM announcements a
      WHERE a."embeddingStatus" = 'EMBEDDED'
        AND a.embedding IS NOT NULL
        AND (1 - (a.embedding <=> ${vectorStr}::vector)) >= ${MATCH_THRESHOLD}
      ORDER BY a.embedding <=> ${vectorStr}::vector
      LIMIT ${VECTOR_CANDIDATE_LIMIT}
    `;

    const keywordQuery = profile.keywordQuery;
    const keywordRows = await this.runKeywordSearch(keywordQuery, KEYWORD_MATCH_LIMIT);
    const merged = this.mergeAndScore(profile, vectorRows, keywordRows);

    const penalized = merged.map((candidate) => {
      const haystack = `${candidate.title} ${candidate.description ?? ""} ${candidate.search_context}`.toLowerCase();
      const negativePenaltyApplied = applyNegativePenalty(haystack, negativeKeywords);
      const hybrid = negativePenaltyApplied
        ? clamp(candidate.hybrid * NEGATIVE_KEYWORD_PENALTY)
        : candidate.hybrid;

      return {
        ...candidate,
        hybrid,
        negativePenaltyApplied,
      };
    });

    const keptAfterFiltersIds = new Set(
      penalized
        .filter((candidate) => this.shouldKeepCandidate(candidate))
        .map((candidate) => candidate.announcement_id),
    );

    const sorted = penalized
      .filter((candidate) => keptAfterFiltersIds.has(candidate.announcement_id))
      .sort((a, b) => b.hybrid - a.hybrid)
      .slice(0, FINAL_MATCH_LIMIT);

    this.logger.log(
      `Topic "${topicTitle}": vector=${vectorRows.length}, keyword=${keywordRows.length}, merged=${merged.length}, pre-rerank=${sorted.length}`,
    );

    const reranked = await this.applyRerank(profile, sorted);
    const rerankWindowIds = new Set(sorted.slice(0, RERANK_WINDOW).map((candidate) => candidate.announcement_id));
    const keptAfterRerankIds = new Set(
      reranked
        .filter((candidate) => candidate.final >= MIN_STORED_MATCH_SCORE)
        .map((candidate) => candidate.announcement_id),
    );
    const rerankedMap = new Map(reranked.map((candidate) => [candidate.announcement_id, candidate] as const));

    const candidates = penalized
      .map((candidate) => {
        const rerankedCandidate = rerankedMap.get(candidate.announcement_id);
        const keptAfterFilters = keptAfterFiltersIds.has(candidate.announcement_id);
        const sentToRerank = rerankWindowIds.has(candidate.announcement_id);
        const keptAfterRerank = keptAfterRerankIds.has(candidate.announcement_id);
        const effective = rerankedCandidate ?? {
          ...candidate,
          final: candidate.hybrid,
          rerank: null,
          rerankReason: null,
          mustHaveSatisfied: null,
          excludeTriggered: null,
          kindFit: null,
          topicCentrality: null,
          scopeType: null,
        };
        const rejectionReasons = this.getCandidateRejectionReasons(candidate, {
          keptAfterFilters,
          sentToRerank,
          keptAfterRerank,
        });

        return {
          announcementId: candidate.announcement_id,
          title: candidate.title,
          semantic: candidate.semantic,
          keyword: candidate.keyword,
          domain: candidate.domain,
          hybrid: candidate.hybrid,
          rerank: effective.rerank,
          final: effective.final,
          keptAfterFilters,
          sentToRerank,
          keptAfterRerank,
          negativePenaltyApplied: candidate.negativePenaltyApplied,
          rejectionReasons,
          rerankReason: effective.rerankReason ?? null,
          mustHaveSatisfied: effective.mustHaveSatisfied ?? null,
          excludeTriggered: effective.excludeTriggered ?? null,
          kindFit: effective.kindFit ?? null,
          topicCentrality: effective.topicCentrality ?? null,
          scopeType: effective.scopeType ?? null,
        };
      })
      .sort((a, b) => b.final - a.final);

    return {
      topicId,
      counts: {
        vector: vectorRows.length,
        keyword: keywordRows.length,
        merged: merged.length,
        preRerank: sorted.length,
        rerankWindow: Math.min(sorted.length, RERANK_WINDOW),
        final: keptAfterRerankIds.size,
      },
      candidates,
    };
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
        detailed_report: string | null;
        embedding: string | null;
        kind: AnnouncementKind | null;
      }>
    >`
      SELECT id, title, description, "searchContext" AS search_context, "detailedReport" AS detailed_report, embedding::text, kind
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
        t.title,
        t.prompt,
        t."negativeKeywords" AS negative_keywords
      FROM topics t
      WHERE t."embeddingStatus" = 'EMBEDDED'
        AND t.embedding IS NOT NULL
        AND (1 - (t.embedding <=> ${announcementVectorStr}::vector)) >= ${ANNOUNCEMENT_MATCH_THRESHOLD}
      ORDER BY t.embedding <=> ${announcementVectorStr}::vector
      LIMIT ${MATCH_LIMIT_TOPICS}
    `;

    if (matchingTopics.length === 0) return;

    this.logger.log(
      `Announcement ${announcementId}: ${matchingTopics.length} topic(s) matched above threshold`,
    );

    const candidates: TopicCandidate[] = [];

    for (const topicRow of matchingTopics) {
      const profile = this.resolveTopicProfile(
        topicRow.title,
        topicRow.prompt,
        (topicRow.negative_keywords ?? []) as string[],
      );
      const domainScore = this.computeDomainScore(
        profile,
        announcementHaystack,
        ann.kind ?? null,
      );
      const negativeKeywords = (topicRow.negative_keywords ?? []) as string[];
      const isPenalized = applyNegativePenalty(announcementHaystack, negativeKeywords);
      const combined = clamp(Number(topicRow.similarity));
      const finalSimilarity = isPenalized
        ? combined * NEGATIVE_KEYWORD_PENALTY
        : combined;

      if (!this.shouldKeepFastMatch(profile, Number(topicRow.similarity), finalSimilarity)) {
        continue;
      }

      candidates.push({
        topic_id: topicRow.topic_id,
        title: topicRow.title,
        prompt: topicRow.prompt,
        negative_keywords: (topicRow.negative_keywords ?? []) as string[],
        semantic: Number(topicRow.similarity),
        domain: domainScore,
        hybrid: finalSimilarity,
        rerank: null,
        final: finalSimilarity,
      });
    }

    if (candidates.length === 0) {
      return;
    }

    const finalCandidates = (await this.applyAnnouncementRerank(
      {
        title: ann.title,
        description: ann.description,
        searchContext: ann.search_context,
        detailedReport: ann.detailed_report,
        kind: ann.kind,
      },
      candidates.sort((left, right) => right.final - left.final),
    )).filter((candidate) => candidate.final >= MIN_STORED_MATCH_SCORE);

    for (const candidate of finalCandidates) {
      await this.prisma.clientMatch.upsert({
        where: {
          topicId_announcementId: { topicId: candidate.topic_id, announcementId },
        },
        create: {
          topicId: candidate.topic_id,
          announcementId,
          similarity: candidate.final,
          status: "NEW",
        },
        update: { similarity: candidate.final, updatedAt: new Date() },
      });
    }

    this.logger.log(
      `Announcement ${announcementId}: persisted ${finalCandidates.length} topic match(es) after rerank`,
    );
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
          a."searchContext" AS search_context,
          a.kind
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
    profile: ResolvedTopicProfile,
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
        kind: row.kind,
        semantic: clamp(Number(row.similarity)),
        keyword: 0,
        domain: 0,
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
          kind: row.kind,
          semantic: 0,
          keyword: kw,
          domain: 0,
          hybrid: 0,
          rerank: null,
          final: 0,
        });
      }
    }

    for (const [id, c] of map) {
      const haystack = `${c.title} ${c.description ?? ""} ${c.search_context}`;
      const domain = this.computeDomainScore(profile, haystack, c.kind);
      map.set(id, {
        ...c,
        domain,
        hybrid: clamp(c.semantic),
      });
    }

    return [...map.values()];
  }

  // ── Private: LLM re-ranking ────────────────────────────────────────────────

  private async applyRerank(
    profile: ResolvedTopicProfile,
    candidates: ScoredCandidate[],
  ): Promise<ScoredCandidate[]> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey || candidates.length === 0) {
      return candidates.map((c) => ({ ...c, final: c.semantic }));
    }

    const window = candidates.slice(0, RERANK_WINDOW);
    const rest = candidates.slice(RERANK_WINDOW);

    try {
      const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5-mini";
      const llm = new ChatOpenAI({
        apiKey,
        model,
        modelKwargs: { response_format: { type: "json_object" } },
      });

      const compact = window.map((c) => ({
        id: c.announcement_id,
        title: c.title,
        context: (c.search_context || c.description || "").slice(0, 1200),
        domain: c.domain,
        hybrid: c.hybrid,
      }));

      const result = await llm.invoke([
        [
          "system",
          `Jesteś ekspertem od zamówień publicznych w Polsce. Oceniasz trafność ogłoszeń dla profilu klienta na podstawie pełnego profilu tematu, a nie tylko ogólnego podobieństwa semantycznego.

Zasady oceny:
- "mustHave" to wymagania kluczowe. Jeśli ogłoszenie nie spełnia rdzenia "mustHave", score powinien być niski, nawet jeśli jest semantycznie podobne.
- "niceToHave" podbija score, ale nie może zastąpić "mustHave".
- "exclude" działa jak sygnał negatywny. Jeśli ogłoszenie wpada w wykluczenia lub typowe błędne skojarzenia, score powinien być bardzo niski.
- "expectedKinds" określa preferowany typ zamówienia. Gdy typ nie pasuje, obniż score, chyba że treść ogłoszenia bardzo wyraźnie pasuje do profilu.
- Oceniaj rzeczywisty zakres prac, branżę, kontekst i intencję zamówienia.
- Bardzo ważne: oceń też, jak centralny jest temat w CAŁYM zamówieniu, a nie tylko czy występuje w treści.
- Jeśli temat jest głównym i dominującym przedmiotem zamówienia, score powinien być wyższy.
- Jeśli temat jest tylko jednym z kilku elementów szerszego zakresu, score powinien być umiarkowany.
- Jeśli temat jest pobocznym lub incydentalnym fragmentem większego, mieszanego zamówienia (np. obok dostaw sprzętu, infrastruktury, wdrożeń wielu systemów, szkoleń, utrzymania), score powinien być wyraźnie niższy.
- Karać ogłoszenia bundled / mixed scope, w których temat pasuje, ale nie stanowi głównej osi zamówienia.
- Rozróżniaj centralność tematu:
  - PRIMARY: temat jest głównym przedmiotem zamówienia
  - SIGNIFICANT: temat jest istotny, ale nie jedyny
  - SECONDARY: temat jest jedną z części większego scope'u
  - INCIDENTAL: temat pojawia się marginalnie lub pomocniczo
- Rozróżniaj typ scope'u:
  - FOCUSED: zamówienie skupione głównie na tym temacie
  - MIXED: zamówienie ma kilka istotnych części
  - BUNDLED: temat jest częścią dużego pakietu z innymi dominującymi elementami
- Jeśli kandydat pasuje tylko przez ogólne słowa (np. usługa, obsługa, szkolenie, pracownicy, grupowy), ale nie pasuje do właściwego zakresu, nadaj score 0-0.15.
- Semantic similarity i keyword match traktuj tylko jako sygnały pomocnicze, nie jako źródło prawdy.

Odpowiedz WYŁĄCZNIE jako JSON:
{"ranked":[{"id":"...","score":0.0-1.0,"reason":"krótki powód po polsku (max 70 znaków)","mustHaveSatisfied":true,"excludeTriggered":false,"kindFit":true,"topicCentrality":"PRIMARY|SIGNIFICANT|SECONDARY|INCIDENTAL","scopeType":"FOCUSED|MIXED|BUNDLED"}]}`,
        ],
        [
          "human",
          `Profil klienta:
Temat: ${profile.title}
Opis / summary: ${profile.summary.slice(0, 1200)}
Frazy obowiązkowe (mustHave): ${profile.mustHave.join(", ") || "brak"}
Frazy mile widziane (niceToHave): ${profile.niceToHave.join(", ") || "brak"}
Frazy wykluczające (exclude): ${profile.exclude.join(", ") || "brak"}
Preferowane typy zamówień (expectedKinds): ${profile.expectedKinds.join(", ") || "brak"}
Kontekst tytułu (titleContext): ${profile.titleContext.join(", ") || "brak"}
Wymagane anchory: ${profile.requiredAnchors.join(", ") || "brak"}
Query keywordowe: ${profile.keywordQuery || "brak"}

Ogłoszenia do oceny:
${JSON.stringify(compact)}`,
        ],
      ]);

      const parsed = this.parseJson<{
        ranked?: Array<{
          id?: string;
          score?: number;
          reason?: string;
          mustHaveSatisfied?: boolean;
          excludeTriggered?: boolean;
          kindFit?: boolean;
          topicCentrality?: "PRIMARY" | "SIGNIFICANT" | "SECONDARY" | "INCIDENTAL";
          scopeType?: "FOCUSED" | "MIXED" | "BUNDLED";
        }>;
      }>(this.extractJsonLikeText(result.content));

      const rerankMap = new Map<
        string,
        {
          score: number;
          reason: string | null;
          mustHaveSatisfied: boolean | null;
          excludeTriggered: boolean | null;
          kindFit: boolean | null;
          topicCentrality: "PRIMARY" | "SIGNIFICANT" | "SECONDARY" | "INCIDENTAL" | null;
          scopeType: "FOCUSED" | "MIXED" | "BUNDLED" | null;
        }
      >();

      for (const row of parsed.ranked ?? []) {
        if (!row.id) continue;
        rerankMap.set(row.id, {
          score: clamp(Number(row.score) || 0),
          reason: row.reason ?? null,
          mustHaveSatisfied: typeof row.mustHaveSatisfied === "boolean" ? row.mustHaveSatisfied : null,
          excludeTriggered: typeof row.excludeTriggered === "boolean" ? row.excludeTriggered : null,
          kindFit: typeof row.kindFit === "boolean" ? row.kindFit : null,
          topicCentrality:
            row.topicCentrality === "PRIMARY"
            || row.topicCentrality === "SIGNIFICANT"
            || row.topicCentrality === "SECONDARY"
            || row.topicCentrality === "INCIDENTAL"
              ? row.topicCentrality
              : null,
          scopeType:
            row.scopeType === "FOCUSED"
            || row.scopeType === "MIXED"
            || row.scopeType === "BUNDLED"
              ? row.scopeType
              : null,
        });
      }

      const rerankWindow = window.map((c) => {
        const rerankRow = rerankMap.get(c.announcement_id) ?? null;
        const rerankScore = rerankRow?.score ?? null;
        const final =
          rerankScore != null
            ? clamp(c.semantic * RERANK_HYBRID_WEIGHT + rerankScore * RERANK_LLM_WEIGHT)
            : c.semantic;
        return {
          ...c,
          rerank: rerankScore,
          final,
          rerankReason: rerankRow?.reason ?? null,
          mustHaveSatisfied: rerankRow?.mustHaveSatisfied ?? null,
          excludeTriggered: rerankRow?.excludeTriggered ?? null,
          kindFit: rerankRow?.kindFit ?? null,
          topicCentrality: rerankRow?.topicCentrality ?? null,
          scopeType: rerankRow?.scopeType ?? null,
        };
      });

      const restScored = rest.map((c) => ({
        ...c,
        final: c.semantic,
        rerankReason: null,
        mustHaveSatisfied: null,
        excludeTriggered: null,
        kindFit: null,
        topicCentrality: null,
        scopeType: null,
      }));
      const all = [...rerankWindow, ...restScored].sort((a, b) => b.final - a.final);

      this.logger.log(
        `Re-ranked top ${window.length} candidates with LLM for topic "${profile.title}"`,
      );
      return all;
    } catch (err) {
      this.logger.warn(
        `LLM re-ranking failed, falling back to semantic score: ${(err as Error).message}`,
      );
      return candidates.map((c) => ({ ...c, final: c.semantic }));
    }
  }

  private async applyAnnouncementRerank(
    announcement: {
      title: string;
      description: string | null;
      searchContext: string;
      detailedReport: string | null;
      kind: AnnouncementKind | null;
    },
    candidates: TopicCandidate[],
  ): Promise<TopicCandidate[]> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey || candidates.length === 0) {
      return candidates;
    }

    const window = candidates.slice(0, RERANK_WINDOW);
    const rest = candidates.slice(RERANK_WINDOW);

    try {
      const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5-mini";
      const llm = new ChatOpenAI({
        apiKey,
        model,
        modelKwargs: { response_format: { type: "json_object" } },
      });

      const compactCandidates = window.map((candidate) => ({
        id: candidate.topic_id,
        title: candidate.title,
        profile: candidate.prompt.slice(0, 320),
        semantic: candidate.semantic,
        domain: candidate.domain,
        hybrid: candidate.hybrid,
      }));

      const result = await llm.invoke([
        [
          "system",
          `Jesteś ekspertem od zamówień publicznych w Polsce. Oceniasz, czy ogłoszenie pasuje do profilu klienta. Dla każdego tematu zwróć score 0.0-1.0 określający trafność dopasowania ogłoszenia do tematu. Bierz pod uwagę branżę, rzeczywisty zakres, wymagania i rodzaj zamówienia. Odpowiedz WYŁĄCZNIE jako JSON: {"ranked":[{"id":"...","score":0.0-1.0,"reason":"krótki powód po polsku (max 70 znaków)"}]}`,
        ],
        [
          "human",
          `Ogłoszenie do oceny:\nTytuł: ${announcement.title}\nRodzaj: ${announcement.kind ?? "INNE"}\nOpis: ${(announcement.description ?? "brak").slice(0, 500)}\nKontekst: ${announcement.searchContext.slice(0, 700)}\nRaport: ${(announcement.detailedReport ?? "brak").slice(0, 1200)}\n\nTematy klienta do oceny:\n${JSON.stringify(compactCandidates)}`,
        ],
      ]);

      const parsed = this.parseJson<{
        ranked?: Array<{ id?: string; score?: number; reason?: string }>;
      }>(this.extractJsonLikeText(result.content));

      const rerankMap = new Map<string, number>();
      for (const row of parsed.ranked ?? []) {
        if (row.id) rerankMap.set(row.id, clamp(Number(row.score) || 0));
      }

      const rerankedWindow = window.map((candidate) => {
        const rerankScore = rerankMap.get(candidate.topic_id) ?? null;
        const final =
          rerankScore != null
            ? clamp(candidate.semantic * RERANK_HYBRID_WEIGHT + rerankScore * RERANK_LLM_WEIGHT)
            : candidate.semantic;

        return {
          ...candidate,
          rerank: rerankScore,
          final,
        };
      });

      const all = [...rerankedWindow, ...rest].sort((left, right) => right.final - left.final);

      this.logger.log(
        `Re-ranked top ${window.length} topic candidate(s) with LLM for announcement "${announcement.title}"`,
      );

      return all;
    } catch (err) {
      this.logger.warn(
        `Announcement LLM re-ranking failed, falling back to hybrid score: ${(err as Error).message}`,
      );
      return candidates;
    }
  }

  // ── Private: JSON parser ───────────────────────────────────────────────────

  private extractJsonLikeText(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") return item;
          if (!item || typeof item !== "object") return "";

          const candidate = item as { text?: string };
          return typeof candidate.text === "string" ? candidate.text : "";
        })
        .join("\n");
    }

    return String(content ?? "");
  }

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

  private extractDomainTokens(text: string, limit: number): string[] {
    if (!text) return [];

    const normalized = normalizeForMatch(text);
    const rawTokens = normalized.match(/[a-z0-9]{4,}/g) ?? [];

    return uniqueTokens(
      rawTokens.filter(
        (token) =>
          !POLISH_STOPWORDS.has(token) &&
          !GENERIC_PROCUREMENT_TOKENS.has(token) &&
          !GENERIC_BUSINESS_TOKENS.has(token) &&
          !PROFILE_FILLER_TOKENS.has(token),
      ),
    ).slice(0, limit);
  }

  private extractTitleContextTokens(text: string, limit: number): string[] {
    if (!text) return [];

    const normalized = normalizeForMatch(text);
    const rawTokens = normalized.match(/[a-z0-9]{4,}/g) ?? [];

    return uniqueTokens(
      rawTokens.filter(
        (token) =>
          !POLISH_STOPWORDS.has(token) &&
          !GENERIC_PROCUREMENT_TOKENS.has(token) &&
          !PROFILE_FILLER_TOKENS.has(token),
      ),
    ).slice(0, limit);
  }

  private computeDomainScore(
    profile: ResolvedTopicProfile,
    announcementText: string,
    announcementKind: AnnouncementKind | null,
  ): number {
    const haystack = normalizeForMatch(announcementText);
    const hasKindMismatch =
      profile.expectedKinds.length > 0 &&
      announcementKind != null &&
      !profile.expectedKinds.includes(announcementKind);

    if (profile.mustHave.length === 0) {
      const niceMatches = profile.niceToHave.filter((term) => hasTermMatch(haystack, term)).length;
      const contextMatches = profile.titleContext.filter((term) => hasTermMatch(haystack, term)).length;
      const anchorMatches = profile.requiredAnchors.filter((term) => hasTermMatch(haystack, term)).length;
      const niceCoverage = profile.niceToHave.length > 0 ? niceMatches / profile.niceToHave.length : 0;
      const contextCoverage = profile.titleContext.length > 0 ? contextMatches / profile.titleContext.length : 0;
      const anchorCoverage = profile.requiredAnchors.length > 0
        ? anchorMatches / profile.requiredAnchors.length
        : 0;
      const kindBonus =
        profile.expectedKinds.length > 0 && announcementKind && profile.expectedKinds.includes(announcementKind)
          ? 0.1
          : 0;

      return clamp(
        (niceCoverage * 0.35 + contextCoverage * 0.4 + anchorCoverage * 0.25) *
          (hasKindMismatch ? 0.45 : 1) +
          kindBonus,
      );
    }

    const mustMatches = profile.mustHave.filter((term) => hasTermMatch(haystack, term)).length;
    const niceMatches = profile.niceToHave.filter((term) => hasTermMatch(haystack, term)).length;
    const contextMatches = profile.titleContext.filter((term) => hasTermMatch(haystack, term)).length;
    const specificTerms = uniqueTokens([
      ...profile.mustHave.filter(isSpecificTerm),
      ...profile.titleContext.filter(isSpecificTerm),
      ...profile.niceToHave.filter(isSpecificTerm),
    ]);
    const specificMatches = specificTerms.filter((term) => hasTermMatch(haystack, term)).length;
    const anchorMatches = profile.requiredAnchors.filter((term) => hasTermMatch(haystack, term)).length;

    if (profile.requiredAnchors.length > 0 && anchorMatches === 0) {
      return 0;
    }

    if (mustMatches === 0) {
      const fallbackScore =
        (profile.niceToHave.length > 0 ? niceMatches / profile.niceToHave.length : 0) * 0.55 +
        (profile.titleContext.length > 0 ? contextMatches / profile.titleContext.length : 0) * 0.45;
      return clamp(fallbackScore * (hasKindMismatch ? 0.45 : 0.65));
    }

    if (profile.titleContext.length > 0 && contextMatches === 0 && specificMatches <= 2) {
      return 0;
    }

    if (specificTerms.length > 0 && specificMatches === 0 && mustMatches <= 1) {
      return 0;
    }

    const mustCoverage = mustMatches / profile.mustHave.length;
    const niceCoverage = profile.niceToHave.length > 0 ? niceMatches / profile.niceToHave.length : 0;
    const contextCoverage = profile.titleContext.length > 0 ? contextMatches / profile.titleContext.length : 0;
    const specificCoverage = specificTerms.length > 0 ? specificMatches / specificTerms.length : 0;
    const kindBonus =
      profile.expectedKinds.length > 0 && announcementKind && profile.expectedKinds.includes(announcementKind)
        ? 0.1
        : 0;

    const rawScore = mustCoverage * 0.5 + niceCoverage * 0.1 + contextCoverage * 0.2 + specificCoverage * 0.2;

    return clamp(rawScore * (hasKindMismatch ? 0.45 : 1) + kindBonus);
  }

  private shouldKeepCandidate(candidate: ScoredCandidate): boolean {
    if (candidate.hybrid < MIN_FINAL_SCORE) {
      return false;
    }

    return candidate.semantic >= STRONG_SEMANTIC_MATCH || candidate.keyword >= STRONG_KEYWORD_MATCH || candidate.hybrid >= MIN_FINAL_SCORE;
  }

  private shouldKeepFastMatch(
    _profile: ResolvedTopicProfile,
    semantic: number,
    finalScore: number,
  ): boolean {
    if (finalScore < MIN_STORED_MATCH_SCORE) {
      return false;
    }

    return semantic >= ANNOUNCEMENT_MATCH_THRESHOLD || finalScore >= MIN_STORED_MATCH_SCORE;
  }

  private getCandidateRejectionReasons(
    candidate: ScoredCandidate & { negativePenaltyApplied?: boolean },
    flags: {
      keptAfterFilters: boolean;
      sentToRerank: boolean;
      keptAfterRerank: boolean;
    },
  ): string[] {
    const reasons: string[] = [];

    if (candidate.negativePenaltyApplied) {
      reasons.push("negative-keyword-penalty");
    }

    if (candidate.hybrid < MIN_FINAL_SCORE) {
      reasons.push("hybrid-below-min-final-score");
    }



    if (!flags.keptAfterFilters) {
      reasons.push("filtered-before-rerank");
    }

    if (flags.keptAfterFilters && !flags.sentToRerank) {
      reasons.push("outside-rerank-window");
    }

    if (flags.sentToRerank && !flags.keptAfterRerank) {
      reasons.push("final-below-stored-threshold");
    }

    return reasons;
  }

  private resolveTopicProfile(
    topicTitle: string,
    topicPrompt: string,
    negativeKeywords: string[],
  ): ResolvedTopicProfile {
    const parsed = parseTopicMatchingProfile(topicPrompt, negativeKeywords);
    const summary = parsed?.summary ?? topicPrompt;
    const titleDomainTokens = this.extractDomainTokens(topicTitle, 6);
    const promptDomainTokens = this.extractDomainTokens(summary, 18);
    const titleContext = this.extractTitleContextTokens(topicTitle, 6).filter(
      (token) => !titleDomainTokens.includes(token),
    );

    const mustHave = uniqueTokens(
      (parsed?.mustHave.length ? parsed.mustHave : [])
        .map((term) => normalizeForMatch(term))
        .filter(Boolean),
    ).slice(0, 8);

    const niceToHave = uniqueTokens(
      (parsed?.niceToHave.length ? parsed.niceToHave : [...titleDomainTokens, ...promptDomainTokens])
        .map((term) => normalizeForMatch(term))
        .filter((term) => term && !mustHave.includes(term)),
    ).slice(0, 10);

    const exclude = uniqueTokens(
      (parsed?.exclude ?? negativeKeywords)
        .map((term) => normalizeForMatch(term))
        .filter(Boolean),
    );

    const keywordQuery = uniqueTokens([...mustHave, ...niceToHave]).slice(0, 14).join(" ");
    const expectedKinds = parsed?.expectedKinds.length
      ? parsed.expectedKinds
      : inferExpectedKinds(`${topicTitle} ${mustHave.join(" ")} ${titleContext.join(" ")}`);
    const requiredAnchors = inferRequiredAnchors(`${topicTitle} ${mustHave.join(" ")} ${niceToHave.join(" ")}`);

    return {
      title: topicTitle,
      summary,
      mustHave,
      niceToHave,
      titleContext: titleContext.map((term) => normalizeForMatch(term)).filter(Boolean),
      exclude,
      expectedKinds,
      requiredAnchors,
      keywordQuery,
      raw: parsed,
    };
  }
}

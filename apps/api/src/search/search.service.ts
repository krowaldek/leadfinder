import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import type { SearchMode, SearchResultItem } from "@leadfinder/contracts";
import { AppEmbeddings, hasValidEmbeddingConfig } from "../common/embeddings.js";

interface RawSearchRow {
  id: string;
  announcement_id: string;
  title: string;
  description: string | null;
  price: unknown;
  source: string;
  external_id: string;
  announcement_title: string;
  value_min: unknown;
  value_max: unknown;
  url: string;
  published_at: Date | null;
  deadline_at: Date | null;
  semantic_similarity: unknown;
  keyword_rank: unknown;
}

interface SearchCandidate {
  row: RawSearchRow;
  score: number;
  semantic: number | null;
  keyword: number | null;
  domain: number | null;
  rerank: number | null;
  feedback: number | null;
  diversity: number | null;
  explanations: string[];
}

interface SemanticSearchResult {
  effectiveQuery: string;
  items: SearchResultItem[];
}

interface RerankResult {
  score: number;
  reason: string;
}

interface DomainScore {
  score: number;
  reasons: string[];
}

const CANDIDATE_MULTIPLIER = 8;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {}

  async semanticSearch(
    query: string,
    limit = 10,
    threshold = 0.3,
    mode: SearchMode = "HYBRID",
  ): Promise<SemanticSearchResult> {
    const normalizedQuery = query.trim();
    const candidateLimit = Math.max(limit * CANDIDATE_MULTIPLIER, 80);

    let effectiveQuery = normalizedQuery;
    let expansionNotes: string[] = [];
    if (mode === "QUERY_EXPANSION" && this.hasValidOpenAiKey()) {
      const expanded = await this.expandQuery(normalizedQuery);
      effectiveQuery = expanded.effectiveQuery;
      expansionNotes = expanded.notes;
    }

    const candidates = await this.collectCandidatesByMode(
      mode,
      normalizedQuery,
      effectiveQuery,
      threshold,
      candidateLimit,
    );

    if (candidates.length === 0) {
      return { effectiveQuery, items: [] };
    }

    let ranked: SearchCandidate[] = candidates;

    if (mode === "RERANK" && this.hasValidOpenAiKey()) {
      const reranked = await this.applyRerank(normalizedQuery, ranked, limit);
      ranked = reranked;
    }

    if (mode === "LEARNING_TO_RANK") {
      ranked = await this.applyFeedbackRanking(ranked);
    }

    if (mode === "DOMAIN_AWARE") {
      ranked = this.applyDomainRanking(normalizedQuery, ranked);
    }

    if (mode === "MULTI_STAGE") {
      ranked = this.applyMultiStageRanking(normalizedQuery, ranked);
    }

    if (mode === "DIVERSIFIED") {
      ranked = this.applyDiversification(ranked);
    }

    const defaultScored = ranked.map((candidate) =>
      candidate.score > 0
        ? candidate
        : {
            ...candidate,
            score: this.hybridScore(candidate.semantic, candidate.keyword),
          },
    );

    const sorted = [...defaultScored].sort((a, b) => b.score - a.score).slice(0, limit);

    const resultItems = sorted.map((candidate) =>
      this.toResultItem(candidate, mode, expansionNotes),
    );

    this.logger.log(
      `Mode=${mode} query="${normalizedQuery.slice(0, 80)}" returned ${resultItems.length} results`,
    );

    return {
      effectiveQuery,
      items: resultItems,
    };
  }

  private hasValidOpenAiKey(): boolean {
    const key = this.config.get<string>("OPENAI_API_KEY") ?? "";
    return key.startsWith("sk-") && !key.includes("xxx");
  }

  private async collectCandidatesByMode(
    mode: SearchMode,
    originalQuery: string,
    effectiveQuery: string,
    threshold: number,
    candidateLimit: number,
  ): Promise<SearchCandidate[]> {
    const canUseEmbeddings = hasValidEmbeddingConfig(this.config);

    if (!canUseEmbeddings) {
      this.logger.warn(
        "Embedding provider is not configured — falling back to keyword-only search.",
      );
      const keywordRows = await this.runKeywordSearch(effectiveQuery, candidateLimit);
      const merged = this.mergeCandidateRows([], keywordRows);
      return merged.map((candidate) => ({
        ...candidate,
        score: candidate.keyword ?? 0,
        explanations: ["Wyszukiwanie pełnotekstowe (brak skonfigurowanego providera embeddings — tryb awaryjny)."],
      }));
    }

    if (mode === "VECTOR") {
      const vectorStr = await this.embedQuery(effectiveQuery);
      const vectorRows = await this.runVectorSearch(vectorStr, candidateLimit, threshold);
      const candidates = this.mergeCandidateRows(vectorRows, []);
      return candidates.map((candidate) => ({
        ...candidate,
        score: candidate.semantic ?? 0,
        explanations: ["Ranking oparty wyłącznie o podobieństwo semantyczne."],
      }));
    }

    if (mode === "MULTI_VECTOR") {
      return this.multiVectorCandidates(originalQuery, threshold, candidateLimit);
    }

    if (mode === "MULTI_STAGE") {
      const vectorStr = await this.embedQuery(effectiveQuery);
      const broadRows = await this.runVectorSearch(
        vectorStr,
        candidateLimit * 2,
        Math.max(0.12, threshold * 0.7),
      );
      const keywordRows = await this.runKeywordSearch(effectiveQuery, candidateLimit);
      const merged = this.mergeCandidateRows(broadRows, keywordRows);
      return merged
        .sort((a, b) => (b.semantic ?? 0) - (a.semantic ?? 0))
        .slice(0, candidateLimit);
    }

    const vectorStr = await this.embedQuery(effectiveQuery);
    const vectorRows = await this.runVectorSearch(vectorStr, candidateLimit, threshold);
    const keywordRows = await this.runKeywordSearch(effectiveQuery, candidateLimit);
    const merged = this.mergeCandidateRows(vectorRows, keywordRows);

    return merged.map((candidate) => ({
      ...candidate,
      score: this.hybridScore(candidate.semantic, candidate.keyword),
      explanations: ["Połączenie dopasowania semantycznego i słów kluczowych."],
    }));
  }

  private async multiVectorCandidates(
    query: string,
    threshold: number,
    candidateLimit: number,
  ): Promise<SearchCandidate[]> {
    const variants = this.buildQueryVariants(query);
    const combinedMap = new Map<string, SearchCandidate>();

    for (const variant of variants) {
      const vectorStr = await this.embedQuery(variant);
      const rows = await this.runVectorSearch(
        vectorStr,
        Math.max(40, Math.floor(candidateLimit / 2)),
        Math.max(0.12, threshold * 0.75),
      );
      const mergedVariant = this.mergeCandidateRows(rows, []);

      for (const candidate of mergedVariant) {
        const current = combinedMap.get(candidate.row.id);
        const variantScore = candidate.semantic ?? 0;

        if (!current) {
          combinedMap.set(candidate.row.id, {
            ...candidate,
            score: variantScore,
            explanations: [`Dopasowanie wariantu zapytania: "${variant}"`],
          });
          continue;
        }

        const updatedSemantic = Math.max(current.semantic ?? 0, variantScore);
        const nextExplanations = [...current.explanations];
        if (!nextExplanations.includes(`Dopasowanie wariantu zapytania: "${variant}"`)) {
          nextExplanations.push(`Dopasowanie wariantu zapytania: "${variant}"`);
        }

        combinedMap.set(candidate.row.id, {
          ...current,
          semantic: updatedSemantic,
          explanations: nextExplanations,
        });
      }
    }

    const keywordRows = await this.runKeywordSearch(query, candidateLimit);
    const keywordMap = this.normalizeKeywordRows(keywordRows);

    const enriched = [...combinedMap.values()].map((candidate) => {
      const keyword = keywordMap.get(candidate.row.id) ?? null;
      const score = (candidate.semantic ?? 0) * 0.75 + (keyword ?? 0) * 0.25;

      return {
        ...candidate,
        keyword,
        score,
      };
    });

    return enriched;
  }

  private async runVectorSearch(
    vectorStr: string,
    limit: number,
    threshold: number,
  ): Promise<RawSearchRow[]> {
    return this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT
        ai.id,
        ai."announcementId" AS announcement_id,
        ai.title,
        ai.description,
        ai.price,
        a."sourceSystem" AS source,
        a."externalId" AS external_id,
        a.title AS announcement_title,
        a."valueMin" AS value_min,
        a."valueMax" AS value_max,
        a.url,
        a."publishedAt" AS published_at,
        a."deadlineAt" AS deadline_at,
        (1 - (ai.embedding <=> ${vectorStr}::vector)) AS semantic_similarity,
        NULL::double precision AS keyword_rank
      FROM announcement_items ai
      JOIN announcements a ON a.id = ai."announcementId"
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND ai.embedding IS NOT NULL
        AND (1 - (ai.embedding <=> ${vectorStr}::vector)) >= ${threshold}
      ORDER BY ai.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;
  }

  private async runKeywordSearch(
    query: string,
    limit: number,
  ): Promise<RawSearchRow[]> {
    return this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT
        ai.id,
        ai."announcementId" AS announcement_id,
        ai.title,
        ai.description,
        ai.price,
        a."sourceSystem" AS source,
        a."externalId" AS external_id,
        a.title AS announcement_title,
        a."valueMin" AS value_min,
        a."valueMax" AS value_max,
        a.url,
        a."publishedAt" AS published_at,
        a."deadlineAt" AS deadline_at,
        NULL::double precision AS semantic_similarity,
        ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(ai.title, '') || ' ' || coalesce(ai.description, '') || ' ' || coalesce(a.title, '')
          ),
          plainto_tsquery('simple', ${query})
        ) AS keyword_rank
      FROM announcement_items ai
      JOIN announcements a ON a.id = ai."announcementId"
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND to_tsvector(
          'simple',
          coalesce(ai.title, '') || ' ' || coalesce(ai.description, '') || ' ' || coalesce(a.title, '')
        ) @@ plainto_tsquery('simple', ${query})
      ORDER BY keyword_rank DESC
      LIMIT ${limit}
    `;
  }

  private mergeCandidateRows(
    vectorRows: RawSearchRow[],
    keywordRows: RawSearchRow[],
  ): SearchCandidate[] {
    const map = new Map<string, SearchCandidate>();

    for (const row of vectorRows) {
      const semantic = this.toSafeNumber(row.semantic_similarity);
      const existing = map.get(row.id);

      if (!existing) {
        map.set(row.id, this.createCandidate(row, semantic, null));
        continue;
      }

      map.set(row.id, {
        ...existing,
        semantic: Math.max(existing.semantic ?? 0, semantic ?? 0),
      });
    }

    const normalizedKeyword = this.normalizeKeywordRows(keywordRows);

    for (const row of keywordRows) {
      const keyword = normalizedKeyword.get(row.id) ?? null;
      const existing = map.get(row.id);

      if (!existing) {
        map.set(row.id, this.createCandidate(row, null, keyword));
        continue;
      }

      map.set(row.id, {
        ...existing,
        keyword: Math.max(existing.keyword ?? 0, keyword ?? 0),
      });
    }

    return [...map.values()];
  }

  private normalizeKeywordRows(rows: RawSearchRow[]): Map<string, number> {
    const ranks = rows
      .map((row) => this.toSafeNumber(row.keyword_rank) ?? 0)
      .filter((rank) => rank > 0);

    const maxRank = ranks.length > 0 ? Math.max(...ranks) : 1;
    const normalized = new Map<string, number>();

    for (const row of rows) {
      const raw = this.toSafeNumber(row.keyword_rank) ?? 0;
      normalized.set(row.id, this.clamp(raw / maxRank));
    }

    return normalized;
  }

  private createCandidate(
    row: RawSearchRow,
    semantic: number | null,
    keyword: number | null,
  ): SearchCandidate {
    return {
      row,
      score: 0,
      semantic,
      keyword,
      domain: null,
      rerank: null,
      feedback: null,
      diversity: null,
      explanations: [],
    };
  }

  private async applyRerank(
    query: string,
    candidates: SearchCandidate[],
    limit: number,
  ): Promise<SearchCandidate[]> {
    const preliminary = [...candidates]
      .map((candidate) => ({
        ...candidate,
        score: this.hybridScore(candidate.semantic, candidate.keyword),
      }))
      .sort((a, b) => b.score - a.score);

    const rerankWindow = preliminary.slice(0, Math.max(limit * 3, 25));
    const rerankMap = await this.rerankWithLLM(query, rerankWindow);

    return preliminary.map((candidate) => {
      const rerank = rerankMap.get(candidate.row.id);
      const rerankScore = rerank?.score ?? null;
      const hybrid = this.hybridScore(candidate.semantic, candidate.keyword);

      const finalScore =
        rerankScore == null ? hybrid : this.clamp(hybrid * 0.45 + rerankScore * 0.55);

      const explanations = [
        "Wynik po semantycznym rerankingu kandydatów przez model LLM.",
      ];
      if (rerank?.reason) {
        explanations.push(rerank.reason);
      }

      return {
        ...candidate,
        rerank: rerankScore,
        score: finalScore,
        explanations,
      };
    });
  }

  private async applyFeedbackRanking(
    candidates: SearchCandidate[],
  ): Promise<SearchCandidate[]> {
    const feedbackScores = await this.getFeedbackScores(candidates.map((c) => c.row.id));

    return candidates.map((candidate) => {
      const hybrid = this.hybridScore(candidate.semantic, candidate.keyword);
      const feedback = feedbackScores.get(candidate.row.id) ?? 0.5;
      const finalScore = this.clamp(hybrid * 0.7 + feedback * 0.3);

      return {
        ...candidate,
        feedback,
        score: finalScore,
        explanations: [
          "Ranking uwzględnia sygnały feedbacku użytkowników (VIEWED/SHORTLISTED/DISMISSED).",
        ],
      };
    });
  }

  private applyDomainRanking(
    query: string,
    candidates: SearchCandidate[],
  ): SearchCandidate[] {
    return candidates.map((candidate) => {
      const domain = this.computeDomainScore(query, candidate.row);
      const semantic = candidate.semantic ?? 0;
      const keyword = candidate.keyword ?? 0;
      const finalScore = this.clamp(semantic * 0.45 + keyword * 0.25 + domain.score * 0.3);

      return {
        ...candidate,
        domain: domain.score,
        score: finalScore,
        explanations: [
          "Ranking z dodatkowymi regułami domenowymi (termin, budżet, źródło).",
          ...domain.reasons,
        ],
      };
    });
  }

  private applyMultiStageRanking(
    query: string,
    candidates: SearchCandidate[],
  ): SearchCandidate[] {
    return candidates.map((candidate) => {
      const domain = this.computeDomainScore(query, candidate.row);
      const semantic = candidate.semantic ?? 0;
      const keyword = candidate.keyword ?? 0;
      const finalScore = this.clamp(semantic * 0.5 + keyword * 0.25 + domain.score * 0.25);

      return {
        ...candidate,
        domain: domain.score,
        score: finalScore,
        explanations: [
          "Tryb 2-etapowy: szeroki recall semantyczny, potem precyzyjny scoring finalny.",
          ...domain.reasons,
        ],
      };
    });
  }

  private applyDiversification(candidates: SearchCandidate[]): SearchCandidate[] {
    const sorted = [...candidates]
      .map((candidate) => ({
        ...candidate,
        score: this.hybridScore(candidate.semantic, candidate.keyword),
      }))
      .sort((a, b) => b.score - a.score);

    const selected: SearchCandidate[] = [];
    const sourceCounts = new Map<string, number>();
    const announcementCounts = new Map<string, number>();
    const remaining = [...sorted];

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const sourcePenalty = (sourceCounts.get(candidate.row.source) ?? 0) * 0.08;
        const announcementPenalty =
          (announcementCounts.get(candidate.row.announcement_id) ?? 0) > 0 ? 0.35 : 0;
        const penalty = sourcePenalty + announcementPenalty;
        const diversifiedScore = candidate.score - penalty;

        if (diversifiedScore > bestScore) {
          bestScore = diversifiedScore;
          bestIndex = i;
        }
      }

      const [picked] = remaining.splice(bestIndex, 1);
      const sourcePenalty = (sourceCounts.get(picked.row.source) ?? 0) * 0.08;
      const announcementPenalty =
        (announcementCounts.get(picked.row.announcement_id) ?? 0) > 0 ? 0.35 : 0;
      const penalty = sourcePenalty + announcementPenalty;

      selected.push({
        ...picked,
        diversity: this.clamp(1 - penalty),
        score: this.clamp(picked.score - penalty),
        explanations: [
          "Ranking z dywersyfikacją (mniej duplikatów od jednego źródła/ogłoszenia).",
        ],
      });

      sourceCounts.set(picked.row.source, (sourceCounts.get(picked.row.source) ?? 0) + 1);
      announcementCounts.set(
        picked.row.announcement_id,
        (announcementCounts.get(picked.row.announcement_id) ?? 0) + 1,
      );
    }

    return selected;
  }

  private async rerankWithLLM(
    query: string,
    candidates: SearchCandidate[],
  ): Promise<Map<string, RerankResult>> {
    try {
      const llm = this.getChatModel();
      const compact = candidates.map((candidate) => ({
        id: candidate.row.id,
        title: candidate.row.title,
        description: candidate.row.description,
        announcementTitle: candidate.row.announcement_title,
        source: candidate.row.source,
        similarity: candidate.semantic,
        keyword: candidate.keyword,
      }));

      const response = await llm.invoke([
        [
          "system",
          "Jesteś rerankerem ofert B2B. Zwróć WYŁĄCZNIE JSON: {\"ranked\":[{\"id\":\"...\",\"score\":0-1,\"reason\":\"krótki powód\"}]}",
        ],
        [
          "human",
          `Zapytanie: ${query}\nKandydaci:\n${JSON.stringify(compact, null, 2)}`,
        ],
      ]);

      const parsed = this.parseJsonFromLLM<{ ranked?: Array<{ id?: string; score?: number; reason?: string }> }>(
        String(response.content),
      );
      const map = new Map<string, RerankResult>();

      for (const row of parsed.ranked ?? []) {
        if (!row.id) continue;
        const score = this.clamp(this.toSafeNumber(row.score) ?? 0);
        map.set(row.id, { score, reason: row.reason ?? "" });
      }

      return map;
    } catch (error) {
      this.logger.warn(`Rerank fallback: ${error instanceof Error ? error.message : String(error)}`);
      return new Map<string, RerankResult>();
    }
  }

  private async expandQuery(
    query: string,
  ): Promise<{ effectiveQuery: string; notes: string[] }> {
    try {
      const llm = this.getChatModel();
      const response = await llm.invoke([
        [
          "system",
          "Rozszerz zapytanie zakupowe. Zwróć WYŁĄCZNIE JSON: {\"expanded\":\"...\",\"terms\":[\"...\"]}",
        ],
        ["human", query],
      ]);
      const parsed = this.parseJsonFromLLM<{ expanded?: string; terms?: string[] }>(
        String(response.content),
      );

      const expanded = parsed.expanded?.trim();
      if (!expanded) return { effectiveQuery: query, notes: [] };

      const terms = (parsed.terms ?? [])
        .map((term) => term.trim())
        .filter((term) => term.length > 0)
        .slice(0, 8);

      return {
        effectiveQuery: expanded,
        notes: terms.length > 0 ? [`Rozszerzenia: ${terms.join(", ")}`] : [],
      };
    } catch (error) {
      this.logger.warn(
        `Query expansion fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { effectiveQuery: query, notes: [] };
    }
  }

  private parseJsonFromLLM<T>(content: string): T {
    try {
      return JSON.parse(content) as T;
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(content.slice(start, end + 1)) as T;
      }
      throw new Error("Failed to parse JSON from LLM response");
    }
  }

  private async getFeedbackScores(itemIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.clientMatch.findMany({
      where: { announcementItemId: { in: itemIds } },
      select: { announcementItemId: true, status: true },
    });

    const weights: Record<string, number> = {
      NEW: 0,
      VIEWED: 0.25,
      DISMISSED: -0.9,
      SHORTLISTED: 1,
    };

    const agg = new Map<string, { sum: number; count: number }>();
    for (const row of rows) {
      const current = agg.get(row.announcementItemId) ?? { sum: 0, count: 0 };
      current.sum += weights[row.status] ?? 0;
      current.count += 1;
      agg.set(row.announcementItemId, current);
    }

    const scores = new Map<string, number>();
    for (const id of itemIds) {
      const stat = agg.get(id);
      if (!stat || stat.count === 0) {
        scores.set(id, 0.5);
        continue;
      }

      const avg = stat.sum / stat.count; // -0.9 .. 1.0
      const normalized = this.clamp((avg + 1) / 2); // 0.05 .. 1.0
      scores.set(id, normalized);
    }

    return scores;
  }

  private computeDomainScore(query: string, row: RawSearchRow): DomainScore {
    const reasons: string[] = [];
    let score = 0;

    const tokens = this.tokenize(query);
    const haystack = `${row.title} ${row.description ?? ""} ${row.announcement_title}`.toLowerCase();

    if (tokens.length > 0) {
      const matched = tokens.filter((token) => haystack.includes(token)).length;
      const coverage = matched / tokens.length;
      if (coverage > 0) {
        score += coverage * 0.4;
        reasons.push(`Pokrycie słów kluczowych: ${(coverage * 100).toFixed(0)}%.`);
      }
    }

    const queryBudget = this.extractBudgetHints(query);
    if (queryBudget && this.valueOverlaps(queryBudget.min, queryBudget.max, row.value_min, row.value_max)) {
      score += 0.3;
      reasons.push("Zgodność z zakładanym budżetem.");
    }

    const lowered = query.toLowerCase();
    const urgent = /(pilne|natychmiast|na już|szybko)/.test(lowered);
    if (urgent && row.deadline_at) {
      const daysToDeadline =
        (row.deadline_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysToDeadline <= 14) {
        score += 0.15;
        reasons.push("Krótki termin pasujący do pilnego zapytania.");
      }
    }

    if (lowered.includes("bk") && row.source === "BAZA_KONKURENCYJNOSCI") {
      score += 0.15;
      reasons.push("Dopasowane preferowane źródło BK.");
    }

    return { score: this.clamp(score), reasons };
  }

  private buildQueryVariants(query: string): string[] {
    const tokens = this.tokenize(query);
    const shortVariant = tokens.slice(0, 8).join(" ");

    const variants = [query];
    if (shortVariant.length > 0 && shortVariant !== query) {
      variants.push(shortVariant);
    }
    variants.push(`kody cpv ${query}`);

    return [...new Set(variants)];
  }

  private tokenize(text: string): string[] {
    return [...new Set(text.toLowerCase().match(/[a-ząćęłńóśźż0-9]{3,}/gi) ?? [])];
  }

  private extractBudgetHints(text: string): { min: number | null; max: number | null } | null {
    const matches = [...text.toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(k|tys|mln|m|zł|pln)?/g)];
    if (matches.length === 0) return null;

    const values = matches
      .map((match) => {
        const raw = Number.parseFloat(match[1].replace(",", "."));
        if (Number.isNaN(raw)) return null;
        const unit = match[2];
        if (unit === "k" || unit === "tys") return raw * 1_000;
        if (unit === "mln" || unit === "m") return raw * 1_000_000;
        return raw;
      })
      .filter((value): value is number => value != null);

    if (values.length === 0) return null;
    if (values.length === 1) return { min: values[0] * 0.8, max: values[0] * 1.2 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  private valueOverlaps(
    queryMin: number | null,
    queryMax: number | null,
    valueMin: unknown,
    valueMax: unknown,
  ): boolean {
    const announcementMin = this.toSafeNumber(valueMin);
    const announcementMax = this.toSafeNumber(valueMax);
    if (queryMin == null || queryMax == null) return false;
    if (announcementMin == null && announcementMax == null) return false;

    const left = announcementMin ?? announcementMax ?? 0;
    const right = announcementMax ?? announcementMin ?? 0;

    return queryMin <= right && queryMax >= left;
  }

  private toResultItem(
    candidate: SearchCandidate,
    mode: SearchMode,
    expansionNotes: string[],
  ): SearchResultItem {
    return {
      id: candidate.row.id,
      announcementId: candidate.row.announcement_id,
      title: candidate.row.title,
      description: candidate.row.description,
      price: candidate.row.price,
      source: candidate.row.source,
      externalId: candidate.row.external_id,
      announcementTitle: candidate.row.announcement_title,
      valueMin: candidate.row.value_min,
      valueMax: candidate.row.value_max,
      url: candidate.row.url,
      publishedAt: candidate.row.published_at ? candidate.row.published_at.toISOString() : null,
      similarity: candidate.semantic ?? 0,
      score: this.clamp(candidate.score),
      mode,
      scores: {
        semantic: candidate.semantic,
        keyword: candidate.keyword,
        domain: candidate.domain,
        rerank: candidate.rerank,
        feedback: candidate.feedback,
        diversity: candidate.diversity,
      },
      explanations: [...candidate.explanations, ...expansionNotes].slice(0, 4),
    };
  }

  private hybridScore(semantic: number | null, keyword: number | null): number {
    return this.clamp((semantic ?? 0) * 0.62 + (keyword ?? 0) * 0.38);
  }

  private async embedQuery(query: string): Promise<string> {
    const embedder = this.getEmbedder();
    const vector = await embedder.embedQuery(query);
    return `[${vector.join(",")}]`;
  }

  private getEmbedder(): AppEmbeddings {
    if (!hasValidEmbeddingConfig(this.config)) {
      throw new Error("Embedding provider is not configured — cannot perform vector search");
    }

    return new AppEmbeddings(this.config);
  }

  private getChatModel(): ChatOpenAI {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set — cannot perform AI search");
    }

    const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    return new ChatOpenAI({ apiKey, model, temperature: 0 });
  }

  private toSafeNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private clamp(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value));
  }
}

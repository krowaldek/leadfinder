// ─── FULL REWRITE – flat Announcement + Topic embedding ───────────────────────
import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { AnnouncementSource } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import { AppEmbeddings, getEmbeddingModel, getEmbeddingProvider } from "../common/embeddings.js";
import {
  extractAttachmentTexts,
  fetchDirectPdfEmbeddingAttachments,
  normalizeAndRankAttachments,
  type AttachmentCacheAdapter,
  type RawAttachmentLike,
} from "../common/attachment-text.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";

const MAX_DIRECT_EMBEDDING_ATTACHMENTS = 2;
const MAX_DIRECT_EMBEDDING_PDF_PAGES = 6;
const ATTACHMENT_VECTOR_WEIGHT = 0.25;
const MAX_EMBEDDING_REPORT_CHARS = 4_500;
const MAX_EMBEDDING_CONTEXT_CHARS = 1_200;
const MAX_ANALYSIS_ATTACHMENT_CHARS = 20_000;
const MAX_CHARS_PER_ANALYSIS_ATTACHMENT = 6_000;
const MAX_ANALYSIS_ATTACHMENTS = 4;

export const ANNOUNCEMENT_KINDS = [
  "DOSTAWA",
  "USLUGA",
  "ROBOTY_BUDOWLANE",
  "SZKOLENIE",
  "USLUGA_IT",
  "USLUGA_BADAWCZO_ROZWOJOWA",
  "DORADZTWO",
  "INNE",
] as const;

export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const KIND_LABELS: Record<AnnouncementKind, string> = {
  DOSTAWA: "Dostawa",
  USLUGA: "Usługa",
  ROBOTY_BUDOWLANE: "Roboty budowlane",
  SZKOLENIE: "Szkolenie",
  USLUGA_IT: "Usługi IT",
  USLUGA_BADAWCZO_ROZWOJOWA: "Usługi badawczo-rozwojowe",
  DORADZTWO: "Doradztwo",
  INNE: "Inne",
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function extractTokenUsage(meta: unknown): TokenUsage | null {
  const usage = (meta as Record<string, unknown> | undefined)?.tokenUsage as
    | Record<string, unknown>
    | undefined;
  if (!usage) return null;
  const p = Number(usage.promptTokens ?? 0);
  const c = Number(usage.completionTokens ?? 0);
  const t = Number(usage.totalTokens ?? p + c);
  if (!p && !c) return null;
  return { promptTokens: p, completionTokens: c, totalTokens: t };
}

const CLASSIFICATION_PROMPT = `Jesteś klasyfikatorem polskich ogłoszeń przetargowych i zapytań ofertowych. Przypisz ogłoszenie do JEDNEJ kategorii.

Kategorie:
DOSTAWA – dostawa towarów, produktów, materiałów, sprzętu, żywności, mebli, pojazdów, urządzeń
USLUGA – ogólne usługi (sprzątanie, ochrona, catering, transport, naprawa, pralnia, opieka)
ROBOTY_BUDOWLANE – prace budowlane, remontowe, modernizacyjne, drogowe, instalacyjne, rozbiórkowe
SZKOLENIE – szkolenia, kursy, warsztaty, studia podyplomowe, konferencje, e-learning, edukacja
USLUGA_IT – usługi IT, oprogramowanie, systemy informatyczne, wdrożenia, hosting, cyberbezpieczeństwo
USLUGA_BADAWCZO_ROZWOJOWA – prace B+R, badania naukowe, ekspertyzy techniczne, analizy, opracowania naukowe
DORADZTWO – doradztwo, konsulting, audyt, usługi prawne, finansowe, HR, rekrutacja, ubezpieczenia
INNE – nie pasuje do żadnej z powyższych kategorii

Odpowiedz WYŁĄCZNIE jedną z tych wartości: DOSTAWA, USLUGA, ROBOTY_BUDOWLANE, SZKOLENIE, USLUGA_IT, USLUGA_BADAWCZO_ROZWOJOWA, DORADZTWO, INNE`;

const ANNOUNCEMENT_ANALYSIS_PROMPT = `Jesteś analitykiem polskich zapytań ofertowych i zamówień publicznych.
Masz dostęp do tytułu, opisu, kontekstu wyszukiwania oraz — jeśli dołączone — do treści kluczowych załączników (OPZ, SIWZ, formularze).

Zwróć WYŁĄCZNIE poprawny JSON bez dodatkowego tekstu, w formacie:
{
  "kind": "DOSTAWA",
  "detailedReport": "## Przedmiot zamówienia\\n...\\n\\n## Zakres i wymagania techniczne\\n...\\n\\n## Konkretne specyfikacje\\n...\\n\\n## Wymagania wobec wykonawcy\\n...\\n\\n## Kryterium wyboru oferty\\n...\\n\\n## Terminy\\n...\\n\\n## Ryzyka i uwagi\\n...",
  "estimatedValue": 150000
}

Zasady:
- kind: jedna z wartości DOSTAWA, USLUGA, ROBOTY_BUDOWLANE, SZKOLENIE, USLUGA_IT, USLUGA_BADAWCZO_ROZWOJOWA, DORADZTWO, INNE
- detailedReport: szczegółowy raport Markdown z sekcjami:
  ## Przedmiot zamówienia — co dokładnie jest przedmiotem (towary, usługi, roboty), skąd pochodzi zamówienie
  ## Zakres i wymagania techniczne — pełny zakres, wymagania techniczne i funkcjonalne; jeśli w OPZ są parametry — wymień je wprost
  ## Konkretne specyfikacje — modele, marki, normy, certyfikaty, parametry ilościowe (m², sztuki, godziny, itp.) z dokumentów
  ## Wymagania wobec wykonawcy — doświadczenie, referencje, certyfikaty, gwarancja, serwis, potencjał kadrowy
  ## Kryterium wyboru oferty — czy cena jest ryczałtowa/kosztorysowa; wagi kryteriów (cena, termin, jakość, itp.)
  ## Terminy — deadline składania ofert, termin realizacji, etapy
  ## Ryzyka i uwagi — niestandardowe warunki, niejasności w dokumentacji, potencjalne problemy
- estimatedValue: liczba PLN netto albo null
- Priorytetyzuj informacje z załączników (OPZ, SIWZ) nad opisem ogólnym
- Cytuj konkretne liczby, parametry, nazwy — nie poprzestawaj na ogólnikach`;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Announcement embedding
  // ---------------------------------------------------------------------------

  async generateAnnouncementEmbedding(announcementId: string): Promise<{ tokenUsage: TokenUsage | null }> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: {
        id: true,
        title: true,
        description: true,
        searchContext: true,
        kind: true,
        detailedReport: true,
        rawData: true,
        sourceSystem: true,
      },
    });

    if (!announcement) {
      throw new NotFoundException(`Announcement not found: ${announcementId}`);
    }

    let tokenUsage: TokenUsage | null = null;
    if (!announcement.kind || !announcement.detailedReport) {
      tokenUsage = await this.analyseAndUpdateAnnouncement(announcementId, announcement);
    }

    const refreshed = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { searchContext: true, kind: true, detailedReport: true, rawData: true, sourceSystem: true },
    });

    if (!refreshed) throw new NotFoundException(`Announcement not found after analysis: ${announcementId}`);

    await this.buildAndSaveEmbedding(announcementId, refreshed);
    return { tokenUsage };
  }

  private async analyseAndUpdateAnnouncement(
    announcementId: string,
    announcement: { title: string; description: string | null; searchContext: string; rawData: unknown; sourceSystem: string | null },
  ): Promise<TokenUsage | null> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      this.logger.warn("OPENAI_API_KEY not set — skipping analysis");
      await this.prisma.announcement.update({ where: { id: announcementId }, data: { kind: "INNE" } });
      return null;
    }

    // Extract attachment texts for LLM context
    const rawData = announcement.rawData as Record<string, unknown> | null;
    const allAttachments: RawAttachmentLike[] = Array.isArray(rawData?.attachments)
      ? (rawData.attachments as RawAttachmentLike[])
      : [];
    let attachmentTexts: string[] = [];
    if (allAttachments.length > 0) {
      try {
        const bkApiBaseUrl = this.config.get<string>("BK_API_BASE_URL");
        const rankedAttachments = normalizeAndRankAttachments(allAttachments, {
          bkApiBaseUrl,
          sourceSystem: announcement.sourceSystem as import("@prisma/client").AnnouncementSource | undefined,
          maxAttachments: MAX_ANALYSIS_ATTACHMENTS,
        });
        const cache = this.createAttachmentCacheAdapter();
        attachmentTexts = await extractAttachmentTexts(
          rankedAttachments,
          {
            maxAttachments: MAX_ANALYSIS_ATTACHMENTS,
            maxCharsPerFile: MAX_CHARS_PER_ANALYSIS_ATTACHMENT,
            maxTotalChars: MAX_ANALYSIS_ATTACHMENT_CHARS,
          },
          this.logger,
          cache,
        );
      } catch (attachErr) {
        this.logger.warn(`analyseAndUpdateAnnouncement: attachment extraction failed: ${attachErr instanceof Error ? attachErr.message : String(attachErr)}`);
      }
    }

    const chatModel = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    const analysis = await this.analyseAnnouncement(announcement, attachmentTexts, apiKey, chatModel);

    await this.prisma.announcement.update({
      where: { id: announcementId },
      data: {
        kind: analysis.kind,
        detailedReport: analysis.detailedReport,
        llmEstimatedValue: analysis.estimatedValue != null ? String(analysis.estimatedValue) : null,
      },
    });

    this.logger.log(`Analysed announcement ${announcementId} → kind=${analysis.kind}, attachments=${attachmentTexts.length}`);
    return analysis.tokenUsage;
  }

  private async buildAndSaveEmbedding(
    announcementId: string,
    data: { searchContext: string; kind: string | null; detailedReport: string | null; rawData: unknown; sourceSystem: string | null },
  ): Promise<void> {
    const embeddingInput = this.buildEmbeddingInput({
      kind: (data.kind ?? "INNE") as AnnouncementKind,
      detailedReport: data.detailedReport,
      searchContext: data.searchContext,
    });

    this.logger.debug(
      `Embedding announcement ${announcementId} | provider="${getEmbeddingProvider(this.config)}" | model="${getEmbeddingModel(this.config)}" | ${embeddingInput.length} chars`,
    );

    try {
      const embedder = new AppEmbeddings(this.config);
      const [baseVector] = await embedder.embedDocuments([embeddingInput]);
      const attachmentVectors = await this.generateAttachmentPdfEmbeddings(
        data.rawData as Record<string, unknown> | null,
        data.sourceSystem as AnnouncementSource | null | undefined,
        embedder,
      );
      const vector = this.blendVectors(baseVector, attachmentVectors);
      const vectorStr = `[${vector.join(",")}]`;
      const kind = (data.kind ?? "INNE") as AnnouncementKind;

      await this.prisma.$executeRaw`
        UPDATE announcements
        SET
          embedding         = ${vectorStr}::vector,
          kind              = ${kind}::"AnnouncementKind",
          "embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus",
          "updatedAt"       = NOW()
        WHERE id = ${announcementId}::uuid
      `;

      this.logger.log(`Embedded announcement ${announcementId} → kind=${kind} (${vector.length} dims)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to embed announcement ${announcementId}: ${msg}`);
      await this.prisma.announcement.update({ where: { id: announcementId }, data: { embeddingStatus: "ERROR" } });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Topic embedding
  // ---------------------------------------------------------------------------

  async generateTopicEmbedding(topicId: string): Promise<void> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, title: true, prompt: true },
    });

    if (!topic) throw new NotFoundException(`Topic not found: ${topicId}`);

    const input = `TEMAT: ${topic.title}\n\n${topic.prompt}`;

    this.logger.debug(`Embedding topic ${topicId} | ${input.length} chars`);

    try {
      const embedder = new AppEmbeddings(this.config);
      const [vector] = await embedder.embedDocuments([input]);
      const vectorStr = `[${vector.join(",")}]`;

      await this.prisma.$executeRaw`
        UPDATE topics
        SET
          embedding         = ${vectorStr}::vector,
          "embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus",
          "updatedAt"       = NOW()
        WHERE id = ${topicId}::uuid
      `;

      this.logger.log(`Embedded topic ${topicId} (${vector.length} dims)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to embed topic ${topicId}: ${msg}`);
      await this.prisma.topic.update({ where: { id: topicId }, data: { embeddingStatus: "ERROR" } });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Queue helpers
  // ---------------------------------------------------------------------------

  async enqueueAnnouncementEmbedding(announcementId: string): Promise<void> {
    await this.embeddingQueue.add(
      EmbeddingJob.EMBED_ANNOUNCEMENT,
      { announcementId },
      {
        jobId: `announcement-embed-${announcementId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  async enqueueTopicEmbedding(topicId: string): Promise<void> {
    await this.embeddingQueue.add(
      EmbeddingJob.EMBED_TOPIC,
      { topicId },
      {
        jobId: `topic-embed-${topicId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  async backfillAnnouncements(): Promise<number> {
    const announcements = await this.prisma.announcement.findMany({
      where: { OR: [{ kind: null }, { detailedReport: null }, { embeddingStatus: { not: "EMBEDDED" } }] },
      select: { id: true },
    });

    if (announcements.length === 0) {
      this.logger.log("backfillAnnouncements: nothing to do");
      return 0;
    }

    await this.prisma.announcement.updateMany({
      where: { id: { in: announcements.map((a) => a.id) } },
      data: { embeddingStatus: "PENDING" },
    });

    for (const a of announcements) {
      await this.enqueueAnnouncementEmbedding(a.id);
    }

    this.logger.log(`backfillAnnouncements: queued ${announcements.length} jobs`);
    return announcements.length;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEmbeddingInput(input: {
    kind: AnnouncementKind;
    detailedReport: string | null;
    searchContext: string;
  }): string {
    const compactContext =
      input.searchContext.length > MAX_EMBEDDING_CONTEXT_CHARS
        ? `${input.searchContext.slice(0, MAX_EMBEDDING_CONTEXT_CHARS)}…`
        : input.searchContext;
    const compactReport = input.detailedReport
      ? input.detailedReport.slice(0, MAX_EMBEDDING_REPORT_CHARS)
      : null;

    return [
      `RODZAJ: ${KIND_LABELS[input.kind]}`,
      compactReport ? `RAPORT:\n${compactReport}` : null,
      `KONTEKST: ${compactContext}`,
    ]
      .filter((v): v is string => Boolean(v))
      .join("\n\n");
  }

  private async generateAttachmentPdfEmbeddings(
    rawData: Record<string, unknown> | null,
    sourceSystem: AnnouncementSource | null | undefined,
    embedder: AppEmbeddings,
  ): Promise<number[][]> {
    if (getEmbeddingProvider(this.config) !== "GOOGLE") return [];

    const allAttachments: RawAttachmentLike[] = Array.isArray(rawData?.attachments)
      ? (rawData.attachments as RawAttachmentLike[])
      : [];

    if (allAttachments.length === 0) return [];

    const rankedAttachments = normalizeAndRankAttachments(allAttachments, {
      bkApiBaseUrl: this.config.get<string>("BK_API_BASE_URL"),
      sourceSystem: sourceSystem ?? undefined,
      maxAttachments: MAX_DIRECT_EMBEDDING_ATTACHMENTS,
    });

    const pdfAttachments = await fetchDirectPdfEmbeddingAttachments(
      rankedAttachments,
      { maxAttachments: MAX_DIRECT_EMBEDDING_ATTACHMENTS, maxPages: MAX_DIRECT_EMBEDDING_PDF_PAGES },
      this.logger,
    );

    if (pdfAttachments.length === 0) return [];

    return embedder.embedPdfDocuments(pdfAttachments.map((a) => a.buffer));
  }

  private blendVectors(baseVector: number[], attachmentVectors: number[][]): number[] {
    if (attachmentVectors.length === 0) return baseVector;

    const compatibleAttachments = attachmentVectors.filter((v) => v.length === baseVector.length);
    if (compatibleAttachments.length === 0) return baseVector;

    const normalizedBase = this.normalizeVector(baseVector);
    const normalizedAttachments = compatibleAttachments.map((v) => this.normalizeVector(v));
    const attachmentWeight = ATTACHMENT_VECTOR_WEIGHT / normalizedAttachments.length;
    const baseWeight = 1 - ATTACHMENT_VECTOR_WEIGHT;

    const blended = normalizedBase.map((value, index) => {
      let total = value * baseWeight;
      for (const av of normalizedAttachments) total += av[index] * attachmentWeight;
      return total;
    });

    return this.normalizeVector(blended);
  }

  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (!Number.isFinite(magnitude) || magnitude === 0) return vector;
    return vector.map((v) => v / magnitude);
  }

  private async classifyKind(searchContext: string, apiKey: string, model: string): Promise<AnnouncementKind> {
    const chat = new ChatOpenAI({ apiKey, model, temperature: 0, maxTokens: 20 });
    const response = await chat.invoke([
      new SystemMessage(CLASSIFICATION_PROMPT),
      new HumanMessage(searchContext),
    ]);

    const raw = typeof response.content === "string" ? response.content.trim().toUpperCase() : "";
    const matched = ANNOUNCEMENT_KINDS.find((k) => k === raw);
    if (!matched) this.logger.warn(`Unexpected classification: "${raw}" — using INNE`);
    return matched ?? "INNE";
  }

  private async analyseAnnouncement(
    announcement: { title: string; description: string | null; searchContext: string },
    attachmentTexts: string[],
    apiKey: string,
    model: string,
  ): Promise<{ kind: AnnouncementKind; detailedReport: string; estimatedValue: number | null; tokenUsage: TokenUsage | null }> {
    try {
      const chat = new ChatOpenAI({ apiKey, model, temperature: 0, maxTokens: 2_500 });

      const attachmentsContext =
        attachmentTexts.length > 0
          ? `\n\n==================\nTREŚĆ KLUCZOWYCH ZAŁĄCZNIKÓW (OPZ/SIWZ):\n==================\n\n${attachmentTexts.join("\n\n---\n\n")}`
          : "";

      const userMessage = [
        `TYTUŁ: ${announcement.title}`,
        announcement.description ? `OPIS: ${announcement.description}` : null,
        `KONTEKST: ${announcement.searchContext}`,
        attachmentsContext || null,
      ]
        .filter(Boolean)
        .join("\n");

      const response = await chat.invoke([
        new SystemMessage(ANNOUNCEMENT_ANALYSIS_PROMPT),
        new HumanMessage(userMessage),
      ]);

      const tokenUsage = extractTokenUsage(response.response_metadata);
      const raw = typeof response.content === "string" ? response.content.trim() : "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Analysis response did not contain JSON");

      const parsed = JSON.parse(match[0]) as { kind?: unknown; detailedReport?: unknown; estimatedValue?: unknown };
      const kind = ANNOUNCEMENT_KINDS.find((k) => k === parsed.kind) ?? "INNE";
      const estimatedValue =
        typeof parsed.estimatedValue === "number" && Number.isFinite(parsed.estimatedValue)
          ? parsed.estimatedValue
          : null;
      const detailedReport =
        typeof parsed.detailedReport === "string" && parsed.detailedReport.trim().length > 0
          ? parsed.detailedReport.trim()
          : this.buildFallbackReport(announcement.title, announcement.description, announcement.searchContext, estimatedValue);

      return { kind, detailedReport, estimatedValue, tokenUsage };
    } catch (err) {
      this.logger.warn(`analyseAnnouncement failed: ${err instanceof Error ? err.message : String(err)}`);
      const kind = await this.classifyKind(announcement.searchContext, apiKey, model);
      return {
        kind,
        detailedReport: this.buildFallbackReport(announcement.title, announcement.description, announcement.searchContext, null),
        estimatedValue: null,
        tokenUsage: null,
      };
    }
  }

  private createAttachmentCacheAdapter(): AttachmentCacheAdapter {
    return {
      get: (cacheKey) =>
        this.prisma.attachmentCache.findUnique({
          where: { cacheKey },
          select: {
            cacheKey: true,
            extractedText: true,
            extractionMethod: true,
            status: true,
            failureReason: true,
          },
        }),
      set: async (input) => {
        await this.prisma.attachmentCache.upsert({
          where: { cacheKey: input.cacheKey },
          create: {
            cacheKey: input.cacheKey,
            sourceSystem: input.sourceSystem,
            attachmentUrl: input.attachmentUrl,
            attachmentName: input.attachmentName,
            fileExt: input.fileExt,
            contentType: input.contentType,
            extractedText: input.extractedText,
            extractionMethod: input.extractionMethod,
            status: input.status,
            failureReason: input.failureReason,
            lastFetchedAt: new Date(),
          },
          update: {
            sourceSystem: input.sourceSystem,
            attachmentUrl: input.attachmentUrl,
            attachmentName: input.attachmentName,
            fileExt: input.fileExt,
            contentType: input.contentType,
            extractedText: input.extractedText,
            extractionMethod: input.extractionMethod,
            status: input.status,
            failureReason: input.failureReason,
            lastFetchedAt: new Date(),
          },
        });
      },
    };
  }

  private buildFallbackReport(
    title: string,
    description: string | null,
    searchContext: string,
    estimatedValue: number | null,
  ): string {
    return [
      "## Przedmiot zamówienia",
      title,
      "",
      "## Zakres i wymagania",
      description?.trim() ? description.trim().slice(0, 2_000) : "Brak opisu.",
      "",
      "## Konkretne specyfikacje",
      "Brak szczegółowych specyfikacji — sprawdź załączniki i OPZ.",
      "",
      "## Terminy i warunki",
      estimatedValue != null
        ? `Szacunkowa wartość: ${estimatedValue.toLocaleString("pl-PL")} PLN netto.`
        : "Brak wartości szacunkowej.",
      "",
      "## Ryzyka",
      searchContext.slice(0, 2_000),
    ].join("\n");
  }
}


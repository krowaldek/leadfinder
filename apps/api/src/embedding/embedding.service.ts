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
  fetchDirectPdfEmbeddingAttachments,
  normalizeAndRankAttachments,
  type RawAttachmentLike,
} from "../common/attachment-text.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";

const MAX_DIRECT_EMBEDDING_ATTACHMENTS = 2;
const MAX_DIRECT_EMBEDDING_PDF_PAGES = 6;
const ATTACHMENT_VECTOR_WEIGHT = 0.25;
const MAX_EMBEDDING_REPORT_CHARS = 4_500;
const MAX_EMBEDDING_CONTEXT_CHARS = 1_200;

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

const ITEM_ANALYSIS_PROMPT = `Jesteś analitykiem polskich zapytań ofertowych. Analizujesz jedną część zamówienia albo jedno ogólne zapytanie.

Zwróć WYŁĄCZNIE poprawny JSON bez dodatkowego tekstu, w formacie:
{
  "kind": "DOSTAWA",
  "summary": "Dostawa: laptopy, monitory, akcesoria",
  "detailedReport": "## Zakres\n...\n\n## Wymagania\n...\n\n## Terminy i warunki\n...\n\n## Ryzyka\n...",
  "estimatedValue": 150000
}

Zasady:
- kind musi być jedną z wartości: DOSTAWA, USLUGA, ROBOTY_BUDOWLANE, SZKOLENIE, USLUGA_IT, USLUGA_BADAWCZO_ROZWOJOWA, DORADZTWO, INNE
- summary: maksymalnie 18 słów, zaczynaj od kategorii po polsku
- detailedReport: zwięzły raport Markdown o TEJ części, z sekcjami: ## Zakres, ## Wymagania, ## Terminy i warunki, ## Ryzyka
- estimatedValue: liczba PLN netto albo null
- nie powielaj formalności urzędowych
- skup się na meritum i wymaganiach wykonania`;

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

  async generateItemReport(itemId: string): Promise<{
    itemId: string;
    announcementId: string;
    kind: AnnouncementKind;
    summary: string;
    detailedReport: string;
    estimatedValue: number | null;
  }> {
    const item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        announcementId: true,
        title: true,
        description: true,
        searchContext: true,
        kind: true,
        shortSummary: true,
        detailedReport: true,
        llmEstimatedValue: true,
      },
    });

    if (!item) {
      throw new NotFoundException(`AnnouncementItem not found: ${itemId}`);
    }

    if (item.kind && item.shortSummary && item.detailedReport) {
      return {
        itemId: item.id,
        announcementId: item.announcementId,
        kind: item.kind as AnnouncementKind,
        summary: item.shortSummary,
        detailedReport: item.detailedReport,
        estimatedValue: item.llmEstimatedValue ? Number(item.llmEstimatedValue) : null,
      };
    }

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set — cannot generate item reports before embedding",
      );
    }

    const chatModel =
      this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    const analysis = await this.analyzeItem(
      {
        title: item.title,
        description: item.description,
        searchContext: item.searchContext,
      },
      apiKey,
      chatModel,
    );

    await this.prisma.announcementItem.update({
      where: { id: itemId },
      data: {
        kind: analysis.kind,
        shortSummary: analysis.summary,
        detailedReport: analysis.detailedReport,
        llmEstimatedValue:
          analysis.estimatedValue != null ? String(analysis.estimatedValue) : null,
        status: "PENDING",
      },
    });

    this.logger.log(`Generated item report for ${itemId} → kind=${analysis.kind}`);

    return {
      itemId: item.id,
      announcementId: item.announcementId,
      kind: analysis.kind,
      summary: analysis.summary,
      detailedReport: analysis.detailedReport,
      estimatedValue: analysis.estimatedValue,
    };
  }

  async queueAnnouncementReportIfReady(announcementId: string): Promise<boolean> {
    const [totalItems, readyItems] = await Promise.all([
      this.prisma.announcementItem.count({ where: { announcementId } }),
      this.prisma.announcementItem.count({
        where: {
          announcementId,
          kind: { not: null },
          shortSummary: { not: null },
          detailedReport: { not: null },
        },
      }),
    ]);

    if (totalItems === 0 || totalItems !== readyItems) {
      return false;
    }

    await this.embeddingQueue.add(
      EmbeddingJob.REPORT_ANNOUNCEMENT,
      { announcementId },
      {
        jobId: `announcement-report-${announcementId}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );

    return true;
  }

  async enqueueEmbeddingJobsForAnnouncement(announcementId: string): Promise<number> {
    const items = await this.prisma.announcementItem.findMany({
      where: { announcementId },
      select: { id: true },
      orderBy: { itemIndex: "asc" },
    });

    for (const item of items) {
      await this.embeddingQueue.add(
        EmbeddingJob.EMBED_ITEM,
        { itemId: item.id },
        {
          jobId: `item-embed-${item.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    }

    return items.length;
  }

  async generateItemEmbedding(itemId: string): Promise<void> {
    let item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        searchContext: true,
        shortSummary: true,
        detailedReport: true,
        kind: true,
        announcement: {
          select: {
            rawData: true,
            sourceSystem: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`AnnouncementItem not found: ${itemId}`);
    }

    if (!item.kind || !item.shortSummary || !item.detailedReport) {
      await this.generateItemReport(itemId);
      item = await this.prisma.announcementItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          searchContext: true,
          shortSummary: true,
          detailedReport: true,
          kind: true,
          announcement: {
            select: {
              rawData: true,
              sourceSystem: true,
            },
          },
        },
      });
    }

    if (!item || !item.kind) {
      throw new Error(`Item ${itemId} does not have report data required for embedding`);
    }

    const embeddingInput = this.buildEmbeddingInput({
      kind: item.kind as AnnouncementKind,
      shortSummary: item.shortSummary,
      detailedReport: item.detailedReport,
      searchContext: item.searchContext,
    });

    const embeddingModel = getEmbeddingModel(this.config);
    const embeddingProvider = getEmbeddingProvider(this.config);

    this.logger.debug(
      `Embedding item ${itemId} | provider="${embeddingProvider}" | model="${embeddingModel}" | context=${embeddingInput.length} chars`,
    );

    try {
      const kind = item.kind as AnnouncementKind;
      const embedder = new AppEmbeddings(this.config);
      const [baseVector] = await embedder.embedDocuments([embeddingInput]);
      const attachmentVectors = await this.generateAttachmentPdfEmbeddings(
        item.announcement?.rawData as Record<string, unknown> | null,
        item.announcement?.sourceSystem,
        embedder,
      );
      const vector = this.blendVectors(baseVector, attachmentVectors);
      const vectorStr = `[${vector.join(",")}]`;

      await this.prisma.$executeRaw`
        UPDATE announcement_items
        SET
          embedding   = ${vectorStr}::vector,
          kind        = ${kind}::"AnnouncementKind",
          status      = 'EMBEDDED'::"AnnouncementItemStatus",
          "updatedAt" = NOW()
        WHERE id = ${itemId}::uuid
      `;

      this.logger.log(
        `Embedded item ${itemId} → kind=${kind} (${vector.length} dims)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to embed item ${itemId}: ${msg}`);
      await this.prisma.announcementItem.update({
        where: { id: itemId },
        data: { status: "ERROR" },
      });
      throw err;
    }
  }

  private buildEmbeddingInput(input: {
    kind: AnnouncementKind;
    shortSummary: string | null;
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
      input.shortSummary ? `PODSUMOWANIE: ${input.shortSummary}` : null,
      compactReport ? `RAPORT CZĘŚCI:\n${compactReport}` : null,
      `KONTEKST BAZOWY: ${compactContext}`,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
  }

  private async generateAttachmentPdfEmbeddings(
    rawData: Record<string, unknown> | null,
    sourceSystem: AnnouncementSource | null | undefined,
    embedder: AppEmbeddings,
  ): Promise<number[][]> {
    if (getEmbeddingProvider(this.config) !== "GOOGLE") {
      return [];
    }

    const allAttachments: RawAttachmentLike[] = Array.isArray(rawData?.attachments)
      ? (rawData.attachments as RawAttachmentLike[])
      : [];

    if (allAttachments.length === 0) {
      return [];
    }

    const rankedAttachments = normalizeAndRankAttachments(allAttachments, {
      bkApiBaseUrl: this.config.get<string>("BK_API_BASE_URL"),
      sourceSystem: sourceSystem ?? undefined,
      maxAttachments: MAX_DIRECT_EMBEDDING_ATTACHMENTS,
    });

    const pdfAttachments = await fetchDirectPdfEmbeddingAttachments(
      rankedAttachments,
      {
        maxAttachments: MAX_DIRECT_EMBEDDING_ATTACHMENTS,
        maxPages: MAX_DIRECT_EMBEDDING_PDF_PAGES,
      },
      this.logger,
    );

    if (pdfAttachments.length === 0) {
      return [];
    }

    this.logger.debug(
      `Embedding ${pdfAttachments.length} short PDF attachment(s) directly with Gemini`,
    );

    return embedder.embedPdfDocuments(pdfAttachments.map((attachment) => attachment.buffer));
  }

  private blendVectors(baseVector: number[], attachmentVectors: number[][]): number[] {
    if (attachmentVectors.length === 0) {
      return baseVector;
    }

    const compatibleAttachments = attachmentVectors.filter(
      (vector) => vector.length === baseVector.length,
    );

    if (compatibleAttachments.length === 0) {
      return baseVector;
    }

    const normalizedBase = this.normalizeVector(baseVector);
    const normalizedAttachments = compatibleAttachments.map((vector) => this.normalizeVector(vector));
    const attachmentWeight = ATTACHMENT_VECTOR_WEIGHT / normalizedAttachments.length;
    const baseWeight = 1 - ATTACHMENT_VECTOR_WEIGHT;

    const blended = normalizedBase.map((value, index) => {
      let total = value * baseWeight;
      for (const attachmentVector of normalizedAttachments) {
        total += attachmentVector[index] * attachmentWeight;
      }
      return total;
    });

    return this.normalizeVector(blended);
  }

  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      return vector;
    }

    return vector.map((value) => value / magnitude);
  }

  async backfillKind(): Promise<number> {
    const items = await this.prisma.announcementItem.findMany({
      where: {
        OR: [{ kind: null }, { shortSummary: null }, { detailedReport: null }],
      },
      select: { id: true },
    });

    if (items.length === 0) {
      this.logger.log("backfillKind: no items requiring report refresh");
      return 0;
    }

    this.logger.log(`backfillKind: resetting ${items.length} items to PENDING/report-first`);

    await this.prisma.announcementItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { status: "PENDING" },
    });

    for (const item of items) {
      await this.embeddingQueue.add(
        EmbeddingJob.REPORT_ITEM,
        { itemId: item.id },
        {
          jobId: `item-report-${item.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    }

    this.logger.log(`backfillKind: queued ${items.length} item report jobs`);
    return items.length;
  }

  private async classifyKind(
    searchContext: string,
    apiKey: string,
    model: string,
  ): Promise<AnnouncementKind> {
    const chat = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0,
      maxTokens: 20,
    });

    const response = await chat.invoke([
      new SystemMessage(CLASSIFICATION_PROMPT),
      new HumanMessage(searchContext),
    ]);

    const raw =
      typeof response.content === "string"
        ? response.content.trim().toUpperCase()
        : "";

    const matched = ANNOUNCEMENT_KINDS.find((kind) => kind === raw);
    if (!matched) {
      this.logger.warn(`Unexpected classification response: "${raw}" — falling back to INNE`);
    }

    return matched ?? "INNE";
  }

  private async analyzeItem(
    item: {
      title: string;
      description: string | null;
      searchContext: string;
    },
    apiKey: string,
    model: string,
  ): Promise<{
    kind: AnnouncementKind;
    summary: string;
    detailedReport: string;
    estimatedValue: number | null;
  }> {
    try {
      const chat = new ChatOpenAI({ apiKey, model, temperature: 0, maxTokens: 1_200 });
      const userMessage = [
        `TYTUŁ: ${item.title}`,
        item.description ? `OPIS: ${item.description}` : null,
        `KONTEKST: ${item.searchContext}`,
      ]
        .filter(Boolean)
        .join("\n");

      const response = await chat.invoke([
        new SystemMessage(ITEM_ANALYSIS_PROMPT),
        new HumanMessage(userMessage),
      ]);

      const raw = typeof response.content === "string" ? response.content.trim() : "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error("Item analysis response did not contain JSON");
      }

      const parsed = JSON.parse(match[0]) as {
        kind?: unknown;
        summary?: unknown;
        detailedReport?: unknown;
        estimatedValue?: unknown;
      };
      const kind = ANNOUNCEMENT_KINDS.find((value) => value === parsed.kind) ?? "INNE";
      const estimatedValue =
        typeof parsed.estimatedValue === "number" && Number.isFinite(parsed.estimatedValue)
          ? parsed.estimatedValue
          : null;
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim().slice(0, 300)
          : `${KIND_LABELS[kind]}: ${item.title}`.slice(0, 300);
      const detailedReport =
        typeof parsed.detailedReport === "string" && parsed.detailedReport.trim().length > 0
          ? parsed.detailedReport.trim()
          : this.buildFallbackDetailedReport(
              item.title,
              item.description,
              item.searchContext,
              summary,
              estimatedValue,
            );

      return { kind, summary, detailedReport, estimatedValue };
    } catch (err) {
      this.logger.warn(`analyzeItem failed: ${err instanceof Error ? err.message : String(err)}`);
      const kind = await this.classifyKind(item.searchContext, apiKey, model);
      const summary = `${KIND_LABELS[kind]}: ${item.title}`.slice(0, 300);
      return {
        kind,
        summary,
        detailedReport: this.buildFallbackDetailedReport(
          item.title,
          item.description,
          item.searchContext,
          summary,
          null,
        ),
        estimatedValue: null,
      };
    }
  }

  private buildFallbackDetailedReport(
    title: string,
    description: string | null,
    searchContext: string,
    summary: string,
    estimatedValue: number | null,
  ): string {
    const compactDescription = description?.trim()
      ? description.trim().slice(0, 2_000)
      : "Brak dodatkowego opisu w danych źródłowych.";
    const compactContext = searchContext.slice(0, 2_000);

    return [
      "## Zakres",
      summary || title,
      "",
      "## Wymagania",
      compactDescription,
      "",
      "## Terminy i warunki",
      estimatedValue != null
        ? `Szacunkowa wartość: ${estimatedValue.toLocaleString("pl-PL")} PLN netto.`
        : "Brak pewnej wartości w danych źródłowych — wymaga doprecyzowania z dokumentacji.",
      "",
      "## Ryzyka",
      compactContext,
    ].join("\n");
  }
}

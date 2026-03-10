import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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

// ── Klasyfikacja rodzaju ogłoszenia ─────────────────────────────────────────

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

// ── Serwis ───────────────────────────────────────────────────────────────────

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

  /**
   * Klasyfikuje rodzaj ogłoszenia, generuje embedding i zapisuje obydwa w DB.
   *
   * Flow:
   *  1. Pobierz item z DB (jeśli kind już ustawiony — reużyj, nie klasyfikuj ponownie).
   *  2. Klasyfikuj kind przez gpt-4o-mini (lub OPENAI_CHAT_MODEL).
   *  3. Zbuduj augmented text: "RODZAJ: <label> | <searchContext>" dla lepszego semantic search.
  *  4. Wygeneruj wektor z augmented text przez skonfigurowany provider embeddings.
   *  5. Zapisz embedding + kind + status=EMBEDDED przez raw SQL (pgvector).
   */
  async generateItemEmbedding(itemId: string): Promise<void> {
    const item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        searchContext: true,
        status: true,
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

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set — cannot classify announcements or generate summaries",
      );
    }

    const embeddingModel = getEmbeddingModel(this.config);
    const embeddingProvider = getEmbeddingProvider(this.config);
    const chatModel =
      this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";

    this.logger.debug(
      `Embedding item ${itemId} | provider="${embeddingProvider}" | model="${embeddingModel}" | context=${item.searchContext.length} chars`,
    );

    try {
      // 1. Klasyfikacja rodzaju — pomiń jeśli już ustawiony (np. przy re-embeddingu)
      const kind: AnnouncementKind =
        (item.kind as AnnouncementKind | null) ??
        (await this.classifyKind(item.searchContext, apiKey, chatModel));

      this.logger.debug(`Item ${itemId} → kind=${kind}`);

      // 2. Augmented text: dołącz RODZAJ do kontekstu aby poprawić jakość wektora
      const kindLabel = KIND_LABELS[kind];
      const augmentedText = `RODZAJ: ${kindLabel} | ${item.searchContext}`;

      // 3. Generowanie wektora z augmented text
      const embedder = new AppEmbeddings(this.config);
      const [baseVector] = await embedder.embedDocuments([augmentedText]);
      const attachmentVectors = await this.generateAttachmentPdfEmbeddings(
        item.announcement?.rawData as Record<string, unknown> | null,
        item.announcement?.sourceSystem,
        embedder,
      );
      const vector = this.blendVectors(baseVector, attachmentVectors);

      // Prisma nie obsługuje pgvector natywnie — zapisujemy przez raw SQL
      const vectorStr = `[${vector.join(",")}]`;

      // 4. Zapis embedding + kind w jednym UPDATE
      await this.prisma.$executeRaw`
        UPDATE announcement_items
        SET
          embedding   = ${vectorStr}::vector,
          kind        = ${kind}::"AnnouncementKind",
          status      = 'EMBEDDED'::"AnnouncementItemStatus",
          "updatedAt" = NOW()
        WHERE id = ${itemId}::uuid
      `;

      // 5. Generuj shortSummary i llmEstimatedValue (na podstawie aktualnego searchContext)
      const { summary, estimatedValue } = await this.generateSummaryAndValue(
        item.searchContext,
        apiKey,
        chatModel,
      );

      await this.prisma.announcementItem.update({
        where: { id: itemId },
        data: {
          shortSummary: summary,
          llmEstimatedValue: estimatedValue != null ? String(estimatedValue) : null,
        },
      });

      this.logger.log(
        `Embedded item ${itemId} → kind=${kind} (${vector.length} dims)`,
      );

      // 6. Jeśli item nie był jeszcze wzbogacony i ogłoszenie ma załączniki PDF
      //    — kolejkuj ENRICH_ITEM (zostanie uruchomiony asynchronicznie po embedowaniu)
      if (!item.searchContext.includes("| ZAŁĄCZNIKI:")) {
        await this.maybeEnqueueEnrichment(itemId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to embed item ${itemId}: ${msg}`);

      // Oznacz jako ERROR — job nie zostanie ponowiony (błąd zapisany w DB)
      await this.prisma.announcementItem.update({
        where: { id: itemId },
        data: { status: "ERROR" },
      });

      throw err; // BullMQ zarejestruje błąd joba (retry / dead-letter)
    }
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

  // ── Prywatne ────────────────────────────────────────────────────────────────

  /**
   * Backfill: resetuje itemy z null kind do PENDING i kolejkuje je ponownie.
   * Zwraca liczbę zakolejkowanych itemów.
   */
  async backfillKind(): Promise<number> {
    const items = await this.prisma.announcementItem.findMany({
      where: { kind: null },
      select: { id: true },
    });

    if (items.length === 0) {
      this.logger.log("backfillKind: no items with null kind");
      return 0;
    }

    this.logger.log(`backfillKind: resetting ${items.length} items to PENDING`);

    await this.prisma.announcementItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { status: "PENDING" },
    });

    for (const item of items) {
      await this.embeddingQueue.add(
        EmbeddingJob.EMBED_ITEM,
        { itemId: item.id },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    }

    this.logger.log(`backfillKind: queued ${items.length} embedding jobs`);
    return items.length;
  }

  // ── Prywatne (klasyfikacja) ──────────────────────────────────────────────────

  /**
   * Używa taniego modelu (gpt-4o-mini) z zerową temperaturą — deterministyczna odpowiedź.
   * Fallback: INNE przy nieoczekiwanej odpowiedzi modelu.
   */
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

    const matched = ANNOUNCEMENT_KINDS.find((k) => k === raw);

    if (!matched) {
      this.logger.warn(
        `Unexpected classification response: "${raw}" — falling back to INNE`,
      );
    }

    return matched ?? "INNE";
  }

  /**
   * Generuje krótkie podsumowanie ogłoszenia i szacowaną wartość na podstawie searchContext.
   * Zwraca JSON: { summary: string, estimatedValue: number | null }
   */
  async generateSummaryAndValue(
    searchContext: string,
    apiKey: string,
    model: string,
  ): Promise<{ summary: string; estimatedValue: number | null }> {
    const FALLBACK = { summary: "", estimatedValue: null };
    try {
      const chat = new ChatOpenAI({ apiKey, model, temperature: 0, maxTokens: 200 });

      const response = await chat.invoke([
        new SystemMessage(
          `Jesteś klasyfikatorem polskich zapytań ofertowych. Na podstawie podanego kontekstu wygeneruj TYLKO JSON (bez żadnego dodatkowego tekstu):
{"summary":"max 15 słów, zaczynaj od kategorii np. Dostawa: notebooki, tablety, gogle VR lub Usługa: sprzątanie biur","estimatedValue":150000}
Zasady:
- summary: kategoria + lista głównych pozycji/zakresu, bez szczegółów
- estimatedValue: liczba PLN netto (int) lub null jeśli nie można oszacować`,
        ),
        new HumanMessage(searchContext),
      ]);

      const raw = typeof response.content === "string" ? response.content.trim() : "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return { summary: raw.slice(0, 200) || "", estimatedValue: null };

      const parsed = JSON.parse(match[0]) as { summary?: string; estimatedValue?: unknown };
      const estimatedValue =
        typeof parsed.estimatedValue === "number" && Number.isFinite(parsed.estimatedValue)
          ? parsed.estimatedValue
          : null;

      return { summary: parsed.summary?.slice(0, 300) ?? "", estimatedValue };
    } catch (err) {
      this.logger.warn(
        `generateSummaryAndValue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return FALLBACK;
    }
  }

  /**
   * Sprawdza czy ogłoszenie powiązane z itemem ma załączniki PDF.
   * Jeśli tak — kolejkuje job ENRICH_ITEM.
   */
  private async maybeEnqueueEnrichment(itemId: string): Promise<void> {
    const item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: {
        announcement: {
          select: { rawData: true },
        },
      },
    });

    const rawData = item?.announcement?.rawData as Record<string, unknown> | null;
    const attachments = Array.isArray(rawData?.attachments)
      ? (rawData.attachments as Array<{ name?: string; file?: { name?: string } }>)
      : [];

    const hasPdf = attachments.some((a) =>
      (a.name ?? a.file?.name ?? "").toLowerCase().endsWith(".pdf"),
    );

    if (!hasPdf) return;

    await this.embeddingQueue.add(
      EmbeddingJob.ENRICH_ITEM,
      { itemId },
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.debug(`Enqueued ENRICH_ITEM for item ${itemId}`);
  }
}

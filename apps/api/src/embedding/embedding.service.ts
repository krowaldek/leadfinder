import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";

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
   *  4. Wygeneruj wektor z augmented text przez text-embedding-3-small.
   *  5. Zapisz embedding + kind + status=EMBEDDED przez raw SQL (pgvector).
   */
  async generateItemEmbedding(itemId: string): Promise<void> {
    const item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: { id: true, searchContext: true, status: true, kind: true },
    });

    if (!item) {
      throw new NotFoundException(`AnnouncementItem not found: ${itemId}`);
    }

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set — cannot generate embeddings",
      );
    }

    const embeddingModel =
      this.config.get<string>("OPENAI_EMBEDDING_MODEL") ??
      "text-embedding-3-small";
    const chatModel =
      this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";

    this.logger.debug(
      `Embedding item ${itemId} | model="${embeddingModel}" | context=${item.searchContext.length} chars`,
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
      const embedder = new OpenAIEmbeddings({ apiKey, model: embeddingModel });
      const [vector] = await embedder.embedDocuments([augmentedText]);

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

      this.logger.log(
        `Embedded item ${itemId} → kind=${kind} (${vector.length} dims)`,
      );

      // 5. Jeśli item nie był jeszcze wzbogacony i ogłoszenie ma załączniki PDF
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

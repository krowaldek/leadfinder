import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";
import {
  extractAttachmentTexts,
  normalizeAndRankAttachments,
  type AttachmentCacheAdapter,
  type RawAttachmentLike,
} from "../common/attachment-text.js";

// ---------------------------------------------------------------------------
// Limity
// ---------------------------------------------------------------------------

/** Maksymalna liczba przetwarzanych załączników per item */
const MAX_ATTACHMENTS = 3;

/** Maksymalna liczba znaków tekstu wyciągniętego z jednego pliku */
const MAX_CHARS_PER_FILE = 4_000;

/** Maksymalna liczba znaków ze wszystkich załączników per item */
const MAX_TOTAL_ATTACHMENT_CHARS = 12_000;

/** Maksymalna liczba tokenów w odpowiedzi GPT */
const MAX_SUMMARY_TOKENS = 500;

/** Znacznik w searchContext — obecność oznacza, że item już był wzbogacony */
const ENRICHMENT_MARKER = "| ZAŁĄCZNIKI:";

const SUMMARY_SYSTEM_PROMPT = `Jesteś asystentem analizującym dokumenty polskich przetargów i zapytań ofertowych.
Na podstawie poniższej treści załączników wypisz najważniejsze informacje w formie zwięzłego opisu (maksymalnie ${MAX_SUMMARY_TOKENS / 4} słów).
Skup się na: przedmiocie i zakresie zamówienia, wymaganiach technicznych, kwalifikacjach wykonawcy, warunkach realizacji.
Pomiń formalności urzędowe. Odpowiedz po polsku w jednym akapicie.`;

// ---------------------------------------------------------------------------
// Serwis
// ---------------------------------------------------------------------------

@Injectable()
export class AttachmentEnrichmentService {
  private readonly logger = new Logger(AttachmentEnrichmentService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue,
  ) {}

  /**
   * Pipeline wzbogacania kontekstu o treść najistotniejszych załączników tekstowych.
   *
   * Kroki:
   *  1. Pobierz AnnouncementItem + Announcement.rawData
   *  2. Wybierz najistotniejsze załączniki tekstowe (PDF/DOCX/TXT/HTML/...)
   *  3. Pobierz każdy plik, wyciągnij tekst, skróć do budżetu znaków
   *  4. Przekaż zebrany tekst do GPT-5 mini → krótkie podsumowanie
   *  5. Dopisz "| ZAŁĄCZNIKI: {summary}" do searchContext
   *  6. Wrzuć item ponownie do kolejki EMBED_ITEM (re-embedding z nowym kontekstem)
   */
  async enrichItem(itemId: string): Promise<void> {
    // ── 1. Pobierz item ──────────────────────────────────────────────────────
    const item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        searchContext: true,
        announcementId: true,
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

    // Idempotentność — skip jeśli już wzbogacony
    if (item.searchContext.includes(ENRICHMENT_MARKER)) {
      this.logger.debug(`Item ${itemId} already enriched — skipping`);
      return;
    }

    // ── 2. Wyciągnij załączniki ──────────────────────────────────────────────
    const rawData = item.announcement.rawData as Record<string, unknown>;
    const allAttachments: RawAttachmentLike[] = Array.isArray(
      rawData.attachments,
    )
      ? (rawData.attachments as RawAttachmentLike[])
      : [];

    const bkApiBase = this.config.get<string>("BK_API_BASE_URL");
    const cache = this.createAttachmentCacheAdapter();
    const rankedAttachments = normalizeAndRankAttachments(allAttachments, {
      bkApiBaseUrl: bkApiBase,
      sourceSystem: item.announcement.sourceSystem,
      maxAttachments: MAX_ATTACHMENTS,
    });

    if (rankedAttachments.length === 0) {
      this.logger.debug(
        `Item ${itemId} — no supported attachments, skipping enrichment`,
      );
      return;
    }

    this.logger.log(
      `Item ${itemId} — enriching with ${rankedAttachments.length} ranked attachment(s)`,
    );

    // ── 3. Pobierz i parsuj pliki ────────────────────────────────────────────
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      this.logger.warn(
        "OPENAI_API_KEY not set — skipping attachment enrichment",
      );
      return;
    }

    const extractedTexts = await extractAttachmentTexts(
      rankedAttachments,
      {
        maxAttachments: MAX_ATTACHMENTS,
        maxCharsPerFile: MAX_CHARS_PER_FILE,
        maxTotalChars: MAX_TOTAL_ATTACHMENT_CHARS,
      },
      this.logger,
      cache,
    );

    if (extractedTexts.length === 0) {
      this.logger.warn(
        `Item ${itemId} — all attachment downloads/parses failed`,
      );
      return;
    }

    // ── 4. Podsumowanie przez GPT ────────────────────────────────────────────
    const combinedText = extractedTexts.join("\n\n---\n\n");
    const summary = await this.summarizeAttachments(combinedText, apiKey);

    if (!summary) {
      this.logger.warn(`Item ${itemId} — GPT summary returned empty, skipping`);
      return;
    }

    // ── 5. Zaktualizuj searchContext ─────────────────────────────────────────
    const enrichedContext = `${item.searchContext} ${ENRICHMENT_MARKER} ${summary}`;

    await this.prisma.announcementItem.update({
      where: { id: itemId },
      data: {
        searchContext: enrichedContext,
        status: "PENDING", // Reset do PENDING — EMBED_ITEM ponownie wygeneruje wektor
      },
    });

    this.logger.log(
      `Item ${itemId} — searchContext enriched (+${summary.length} chars), re-queuing embed`,
    );

    // ── 6. Re-queue EMBED_ITEM ───────────────────────────────────────────────
    await this.embeddingQueue.add(
      EmbeddingJob.EMBED_ITEM,
      { itemId },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  // ── Prywatne ───────────────────────────────────────────────────────────────

  private async summarizeAttachments(
    text: string,
    apiKey: string,
  ): Promise<string | null> {
    const chatModel =
      this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5-mini";

    try {
      const chat = new ChatOpenAI({
        apiKey,
        model: chatModel,
        ...(chatModel.startsWith("gpt-5") ? {} : { temperature: 0 }),
        maxTokens: MAX_SUMMARY_TOKENS,
      });

      const response = await chat.invoke([
        new SystemMessage(SUMMARY_SYSTEM_PROMPT),
        new HumanMessage(text),
      ]);

      const content =
        typeof response.content === "string" ? response.content.trim() : "";

      return content || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`GPT summarization failed: ${msg}`);
      return null;
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
}

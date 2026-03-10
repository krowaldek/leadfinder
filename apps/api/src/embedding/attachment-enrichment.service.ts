import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import axios from "axios";
import { createRequire } from "node:module";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";
import type { BkAttachment } from "../scrapers/bk/bk.mapper.js";

// pdf-parse jest modułem CJS — używamy createRequire dla kompatybilności z ESM
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
  options?: Record<string, unknown>,
) => Promise<{ text: string; numpages: number }>;

// ---------------------------------------------------------------------------
// Limity
// ---------------------------------------------------------------------------

/** Maksymalna liczba przetwarzanych załączników per item */
const MAX_ATTACHMENTS = 3;

/** Maksymalna liczba znaków tekstu wyciągniętego z jednego pliku */
const MAX_CHARS_PER_FILE = 4_000;

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
   * Pipeline wzbogacania kontekstu o treść załączników PDF.
   *
   * Kroki:
   *  1. Pobierz AnnouncementItem + Announcement.rawData
   *  2. Wyciągnij listę załączników PDF (maks. MAX_ATTACHMENTS, skip ZIP/unknown)
   *  3. Pobierz każdy plik, wyciągnij tekst (pdf-parse), skróć do MAX_CHARS_PER_FILE
   *  4. Przekaż zebrany tekst do GPT-4o-mini → krótkie podsumowanie
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
    const allAttachments: BkAttachment[] = Array.isArray(rawData.attachments)
      ? (rawData.attachments as BkAttachment[])
      : [];

    const pdfAttachments = allAttachments
      .filter((a) => a.file?.uri && isPdfByName(a.name ?? a.file?.name ?? ""))
      .slice(0, MAX_ATTACHMENTS);

    if (pdfAttachments.length === 0) {
      this.logger.debug(`Item ${itemId} — no PDF attachments, skipping enrichment`);
      return;
    }

    this.logger.log(
      `Item ${itemId} — enriching with ${pdfAttachments.length} PDF attachment(s)`,
    );

    // ── 3. Pobierz i parsuj pliki ────────────────────────────────────────────
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      this.logger.warn("OPENAI_API_KEY not set — skipping attachment enrichment");
      return;
    }

    const bkApiBase = this.config.get<string>("BK_API_BASE_URL");
    if (!bkApiBase) {
      this.logger.warn("BK_API_BASE_URL not set — cannot download attachments");
      return;
    }

    const extractedTexts: string[] = [];

    for (const attachment of pdfAttachments) {
      const fileUrl = buildFileUrl(bkApiBase, attachment.file.uri);
      try {
        const text = await this.downloadAndExtractPdf(fileUrl, attachment.name);
        if (text) {
          extractedTexts.push(`[${attachment.name}]\n${text}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to process attachment "${attachment.name}": ${msg}`);
        // Kontynuuj z pozostałymi załącznikami
      }
    }

    if (extractedTexts.length === 0) {
      this.logger.warn(`Item ${itemId} — all attachment downloads/parses failed`);
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

  private async downloadAndExtractPdf(
    url: string,
    name: string,
  ): Promise<string | null> {
    this.logger.debug(`Downloading attachment: ${url}`);

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 30_000,
      maxContentLength: 20 * 1024 * 1024, // 20 MB hard limit
    });

    const buffer = Buffer.from(response.data);
    this.logger.debug(
      `Downloaded "${name}" — ${(buffer.byteLength / 1024).toFixed(0)} kB`,
    );

    const parsed = await pdfParse(buffer, { max: 10 }); // maks. 10 stron
    const text = parsed.text.replace(/\s+/g, " ").trim();

    if (!text) {
      this.logger.debug(`"${name}" — no extractable text (scan/image PDF?)`);
      return null;
    }

    return text.slice(0, MAX_CHARS_PER_FILE);
  }

  private async summarizeAttachments(
    text: string,
    apiKey: string,
  ): Promise<string | null> {
    const chatModel =
      this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";

    try {
      const chat = new ChatOpenAI({
        apiKey,
        model: chatModel,
        temperature: 0,
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPdfByName(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

/**
 * Buduje URL do pliku z BK API.
 * uri ma postać "/api/files/{id}" — łączymy z bazą API (np. "https://.../api").
 * Ponieważ uri zaczyna się od "/api/", wycinamy "/api" z bazy żeby nie duplikować.
 */
function buildFileUrl(apiBaseUrl: string, fileUri: string): string {
  // apiBaseUrl np. "https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api"
  // fileUri np. "/api/files/2383677"
  // wynik: "https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/files/2383677"
  const base = apiBaseUrl.endsWith("/api")
    ? apiBaseUrl.slice(0, -4) // usuń trailing /api
    : apiBaseUrl.replace(/\/$/, "");
  return `${base}${fileUri}`;
}

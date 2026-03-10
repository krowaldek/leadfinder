import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import {
  extractAttachmentTexts,
  normalizeAndRankAttachments,
  type AttachmentCacheAdapter,
  type RawAttachmentLike,
} from "../common/attachment-text.js";

const MAX_CHARS_PER_FILE = 7_000;
const MAX_TOTAL_ATTACHMENT_CHARS = 24_000;
const MAX_ATTACHMENTS = 5;

const REPORT_SYSTEM_PROMPT = `Jesteś ekspertem analizującym polskie zapytania ofertowe i przetargi publiczne.
Wygeneruj pełny raport analizy w języku polskim na podstawie podanych danych.
Odpowiedź formatuj jako Markdown (używaj nagłówków ##, list, pogrubień).

Raport MUSI zawierać następujące sekcje:

## Przedmiot zamówienia
Klarowny opis czego dotyczy zapytanie — co jest dostarczane, jakie usługi lub roboty są realizowane.

## Pozycje / Zakres prac
Lista głównych pozycji lub zakresu prac z najważniejszymi specyfikacjami technicznymi i ilościami.

## Szacunkowa wartość zamówienia
Podaj szacunkową wartość netto (PLN). Jeśli jest podana wprost — zacytuj. Jeśli nie — oszacuj na podstawie zakresu i typowych stawek rynkowych; podaj uzasadnienie.

## Wymagania wobec wykonawcy
- Wymagane doświadczenie i referencje
- Certyfikaty, uprawnienia, licencje
- Gwarancja i warunki serwisu
- Inne warunki kwalifikacyjne

## Kryterium i sposób obliczania ceny
Czy cena jest ryczałtowa, kosztorysowa, czy mieszana? Jakie są kryteria wyboru oferty (cena, termin, jakość)?

## Terminy
- Termin składania ofert
- Termin realizacji zamówienia

## Uwagi i ryzyka
Wszelkie niestandardowe warunki, klauzule, ryzyka lub uwagi istotne dla potencjalnego wykonawcy.

Pisz zwięźle i konkretnie. Pomijaj formalności urzędowe i powtarzające się fragmenty prawne.`;

@Injectable()
export class AnnouncementReportService {
  private readonly logger = new Logger(AnnouncementReportService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {}

  /**
   * Generuje pełny raport analityczny dla ogłoszenia.
   * Pobiera treść PDF-ów, agreguje konteksty pozycji i wywołuje GPT.
   * Wynik zapisuje w announcement.detailedReport i zwraca jako string.
   */
  async generateReport(announcementId: string): Promise<string> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: {
        id: true,
        sourceSystem: true,
        title: true,
        description: true,
        rawData: true,
        detailedReport: true,
        items: {
          select: {
            id: true,
            title: true,
            description: true,
            searchContext: true,
            shortSummary: true,
            llmEstimatedValue: true,
            kind: true,
          },
          orderBy: { itemIndex: "asc" },
        },
      },
    });

    if (!announcement) throw new NotFoundException("Announcement not found");

    // ── 1. Zbierz i wybierz najistotniejsze załączniki ──────────────────────
    const rawData = announcement.rawData as Record<string, unknown> | null;
    const allAttachments: RawAttachmentLike[] = Array.isArray(rawData?.attachments)
      ? (rawData.attachments as RawAttachmentLike[])
      : [];
    const bkApiBaseUrl = this.config.get<string>("BK_API_BASE_URL");
    const cache = this.createAttachmentCacheAdapter();
    const rankedAttachments = normalizeAndRankAttachments(allAttachments, {
      bkApiBaseUrl,
      sourceSystem: announcement.sourceSystem,
      maxAttachments: MAX_ATTACHMENTS,
    });

    const attachmentTexts = await extractAttachmentTexts(
      rankedAttachments,
      {
        maxAttachments: MAX_ATTACHMENTS,
        maxCharsPerFile: MAX_CHARS_PER_FILE,
        maxTotalChars: MAX_TOTAL_ATTACHMENT_CHARS,
      },
      this.logger,
      cache,
    );

    // ── 2. Zbuduj kontekst pozycji ───────────────────────────────────────────
    const itemsContext = announcement.items
      .map((item, i) => {
        const parts: string[] = [`[Pozycja ${i + 1}] ${item.title}`];
        if (item.description) parts.push(`Opis: ${item.description}`);
        if (item.shortSummary) parts.push(`Podsumowanie LLM: ${item.shortSummary}`);
        if (item.llmEstimatedValue)
          parts.push(`Wartość szacunkowa LLM: ${item.llmEstimatedValue.toString()} PLN`);
        if (item.searchContext) {
          parts.push(`Kontekst:\n${item.searchContext.slice(0, 2_000)}`);
        }
        return parts.join("\n");
      })
      .join("\n\n---\n\n");

    const attachmentsContext =
      attachmentTexts.length > 0
        ? `\n\n==================\nTREŚĆ KLUCZOWYCH ZAŁĄCZNIKÓW:\n==================\n\n${attachmentTexts.join("\n\n---\n\n")}`
        : "\n\n(Brak dostępnych załączników tekstowych do analizy.)";

    // ── 3. Wywołaj GPT ───────────────────────────────────────────────────────
    const apiKey = this.config.getOrThrow("OPENAI_API_KEY");
    const chatModel = this.config.get("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";

    const userMessage = [
      `OGŁOSZENIE: ${announcement.title}`,
      announcement.description ? `OPIS: ${announcement.description}` : null,
      `\nPOZYCJE:\n${itemsContext}`,
      attachmentsContext,
    ]
      .filter(Boolean)
      .join("\n");

    const chat = new ChatOpenAI({
      apiKey,
      model: chatModel,
      temperature: 0.1,
      maxTokens: 2_500,
    });

    const response = await chat.invoke([
      new SystemMessage(REPORT_SYSTEM_PROMPT),
      new HumanMessage(userMessage),
    ]);

    const report = typeof response.content === "string" ? response.content.trim() : "";

    // ── 4. Zapisz wynik ──────────────────────────────────────────────────────
    await this.prisma.announcement.update({
      where: { id: announcementId },
      data: { detailedReport: report },
    });

    this.logger.log(`Report generated for announcement ${announcementId} (${report.length} chars)`);
    return report;
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

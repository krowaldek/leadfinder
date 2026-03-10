import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRequire } from "node:module";
import axios from "axios";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";

// pdf-parse jest modułem CJS — używamy createRequire dla kompatybilności z ESM
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
  options?: Record<string, unknown>,
) => Promise<{ text: string; numpages: number }>;

const MAX_CHARS_PER_FILE = 5_000;
const MAX_ATTACHMENTS = 3;

interface RawAttachment {
  name: string;
  url: string;
  type?: string;
}

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

    // ── 1. Zbierz załączniki PDF ─────────────────────────────────────────────
    const rawData = announcement.rawData as Record<string, unknown> | null;
    const allAttachments: RawAttachment[] = Array.isArray(rawData?.attachments)
      ? (rawData!.attachments as RawAttachment[]).filter(
          (a) => typeof a.url === "string" && typeof a.name === "string",
        )
      : [];

    const pdfAttachments = allAttachments
      .filter((a) => {
        const name = a.name.toLowerCase();
        return name.endsWith(".pdf") || a.type === "pdf";
      })
      .slice(0, MAX_ATTACHMENTS);

    const pdfTexts: string[] = [];
    for (const att of pdfAttachments) {
      try {
        const res = await axios.get<ArrayBuffer>(att.url, {
          responseType: "arraybuffer",
          timeout: 30_000,
          maxContentLength: 20 * 1024 * 1024,
        });
        const buf = Buffer.from(res.data);
        const parsed = await pdfParse(buf, { max: 10 });
        const text = parsed.text.replace(/\s{3,}/g, "\n").trim().slice(0, MAX_CHARS_PER_FILE);
        pdfTexts.push(`--- ${att.name} ---\n${text}`);
        this.logger.debug(`Parsed PDF: ${att.name} (${text.length} chars)`);
      } catch (err) {
        this.logger.warn(
          `PDF parse failed (${att.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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
      pdfTexts.length > 0
        ? `\n\n==================\nTREŚĆ ZAŁĄCZNIKÓW PDF:\n==================\n\n${pdfTexts.join("\n\n")}`
        : "\n\n(Brak dostępnych załączników PDF.)";

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
}

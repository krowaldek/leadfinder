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
import { buildAiOperationLog } from "../common/ai-usage.js";
import { EmbeddingService } from "../embedding/embedding.service.js";
import { JobLoggerService } from "../logs/job-logger.service.js";

const MAX_CHARS_PER_FILE = 7_000;
const MAX_TOTAL_ATTACHMENT_CHARS = 24_000;
const MAX_ATTACHMENTS = 5;

interface BkCpvItem {
  code?: string;
  name?: string;
}

interface BkOrderItem {
  description?: string;
  estimated_value?: number | string | null;
  cpv_items?: BkCpvItem[];
  category?: { name?: string };
  subcategory?: { name?: string };
}

interface BkOrder {
  title?: string;
  estimated_value?: number | string | null;
  order_items?: BkOrderItem[];
}

interface ReportRawData {
  orders?: BkOrder[];
  [key: string]: unknown;
}

const REPORT_SYSTEM_PROMPT = `Jesteś ekspertem analizującym polskie zapytania ofertowe i przetargi publiczne.
Twoim celem jest MAKSYMALNE ROZPRACOWANIE zapytania — wyciągnięcie z niego wszystkiego, czego wykonawca potrzebuje, aby przygotować ofertę i wycenić pracę.
Odpowiedź formatuj jako Markdown (używaj nagłówków ##, list, pogrubień **bold**, tabel jeśli przydatne).

Raport MUSI zawierać następujące sekcje:

## Przedmiot zamówienia
Konkretny, wyczerpujący opis — co jest dostarczane, jakie usługi lub roboty są realizowane i jaki jest cel końcowy.

## Lokalizacja realizacji
Wskaż miejsce realizacji, dostawy lub świadczenia usługi. Jeśli dane są niepełne, wypisz wszystko co wiadomo: miasto,
województwo, adres dostawy, obszar realizacji, siedzibę zamawiającego albo informację, że lokalizacja nie została
jednoznacznie podana.

## Szczegółowy zakres prac
Dla KAŻDEJ pozycji lub zadania podaj:
- dokładny opis czynności lub produktu
- ilości, wymiary, parametry techniczne (napięcie, moc, przepustowość, pojemność itp.)
- konkretne nazwy produktów, marek, modeli, systemów — jeśli są podane wprost lub dają się wywnioskować z kontekstu
- wymagane standardy i normy (ISO, CE, PN-EN, klasy energetyczne, stopnie IP, RODO, itp.)
- zależności między pozycjami lub etapami

## Wymagane produkty, materiały i technologie
Sporządź listę KONKRETNYCH rzeczy niezbędnych do realizacji:
- nazwy marek, modeli, produktów (wskazane wprost lub typowe dla branży równoważniki)
- wymagane wersje oprogramowania, platformy, licencje, API
- materiały budowlane / instalacyjne z parametrami
- sprzęt, urządzenia, narzędzia specjalistyczne
Jeśli zamawiający dopuszcza produkty równoważne — zaznacz to i podaj parametry graniczne.

## Szacunek kosztów
Oszacuj wartość zamówienia netto (PLN) z pełnym uzasadnieniem:
- jeśli wartość podana wprost — zacytuj i wskaż źródło
- jeśli nie — rozbij na składowe: **robocizna**, **materiały / sprzęt**, **licencje / oprogramowanie**, **transport / logistyka**, **inne**
- dla każdej składowej podaj przyjętą stawkę lub cenę jednostkową i podstawę szacunku (ceny rynkowe, katalogi, doświadczenie branżowe)
- podaj przedział min–max jeśli zakres jest niepewny
- na końcu podsumuj: **Szacowana wartość łączna: X – Y PLN netto**

## Wymagania wobec wykonawcy
- wymagane doświadczenie i referencje (konkretna liczba realizacji, minimalna wartość kontraktu)
- certyfikaty, uprawnienia, licencje branżowe (UDT, SEP, ISO, inne)
- wymagania kadrowe (kwalifikacje, liczba osób, dostępność)
- gwarancja i serwis / SLA (czas reakcji, czas naprawy, okres gwarancji)
- inne warunki kwalifikacyjne lub wykluczenia

## Kryteria oceny i warunki handlowe
- kryteria wyboru oferty z wagami (np. cena 60 %, termin 20 %, jakość 20 %)
- forma wynagrodzenia: ryczałt / kosztorys / mieszana
- warunki płatności: przelew X dni, zaliczka, harmonogram fakturowania
- kary umowne i ich wysokość

## Terminy
- termin składania ofert / ważność oferty
- termin realizacji / etapy / kamienie milowe

## Ryzyka i zalecenia dla wykonawcy
- niestandardowe klauzule lub ryzyka kontraktowe
- niejasności lub braki w opisie wymagające pytań do zamawiającego
- typowe pułapki przy tego rodzaju zamówieniach
- konkretne zalecenia: co sprawdzić, co wycenić z rezerwą, na co zwrócić uwagę przed złożeniem oferty

Pisz wyczerpująco i technicznie. Nie pomijaj żadnych danych liczbowych ani nazw. Pomijaj jedynie puste formalności urzędowe.`;

const COMPACT_REPORT_SYSTEM_PROMPT = `Przygotuj po polsku raport Markdown dla wykonawcy. Zachowaj sekcje:
## Przedmiot zamówienia
## Lokalizacja realizacji
## Szczegółowy zakres prac
## Wymagane produkty, materiały i technologie
## Szacunek kosztów
## Wymagania wobec wykonawcy
## Kryteria oceny i warunki handlowe
## Terminy
## Ryzyka i zalecenia dla wykonawcy

Pisz konkretnie i technicznie. Jeśli danych brakuje, zaznacz to wprost. Nie dodawaj wstępu ani zakończenia.`;

function createChatModel(apiKey: string, model: string, maxTokens: number) {
  return new ChatOpenAI({
    apiKey,
    model,
    maxTokens,
    ...(model.startsWith("gpt-5") ? { reasoningEffort: "low" } : { temperature: 0.1 }),
  });
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (!block || typeof block !== "object") return "";

        const candidate = block as { type?: string; text?: string; reasoning?: string };
        if (typeof candidate.text === "string") return candidate.text;
        if (candidate.type === "reasoning" && typeof candidate.reasoning === "string") return candidate.reasoning;
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

@Injectable()
export class AnnouncementReportService {
  private readonly logger = new Logger(AnnouncementReportService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
    @Inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @Inject(JobLoggerService)
    private readonly jobLogger: JobLoggerService,
  ) {}

  /**
   * Generuje pełny raport analityczny dla ogłoszenia.
   * Pobiera treść PDF-ów, agreguje konteksty pozycji i wywołuje GPT.
   * Wynik zapisuje w announcement.detailedReport i zwraca jako string.
   */
  async generateReport(
    announcementId: string,
    options?: { log?: boolean },
  ): Promise<string> {
    const shouldLog = options?.log ?? true;
    const logId = shouldLog
      ? await this.jobLogger.start({
          type: "REPORT",
          jobName: "GENERATE_REPORT",
          entityId: announcementId,
          payload: { announcementId },
        })
      : null;

    try {
      return await this._doGenerateReport(announcementId, logId);
    } catch (err) {
      if (logId) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
      }
      throw err;
    }
  }

  private async _doGenerateReport(
    announcementId: string,
    logId: string | null,
  ): Promise<string> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: {
        id: true,
        sourceSystem: true,
        title: true,
        description: true,
        searchContext: true,
        rawData: true,
        detailedReport: true,
        embeddingStatus: true,
      },
    });

    if (!announcement) throw new NotFoundException("Announcement not found");

    // ── 1. Zbierz i wybierz najistotniejsze załączniki ──────────────────────
    const rawData = announcement.rawData as ReportRawData | null;
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
    const itemsContext = this.buildItemsContext(rawData, {
      title: announcement.title,
      description: announcement.description,
      searchContext: announcement.searchContext,
    });
    const locationContext = this.extractLocationContext(announcement.sourceSystem, rawData, {
      title: announcement.title,
      description: announcement.description,
      searchContext: announcement.searchContext,
    });

    const attachmentsContext =
      attachmentTexts.length > 0
        ? `\n\n==================\nTREŚĆ KLUCZOWYCH ZAŁĄCZNIKÓW:\n==================\n\n${attachmentTexts.join("\n\n---\n\n")}`
        : "\n\n(Brak dostępnych załączników tekstowych do analizy.)";

    // ── 3. Wywołaj GPT ───────────────────────────────────────────────────────
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    const chatModel = this.config.get("OPENAI_CHAT_MODEL") ?? "gpt-5-mini";

    const userMessage = [
      `OGŁOSZENIE: ${announcement.title}`,
      announcement.description ? `OPIS: ${announcement.description}` : null,
      announcement.searchContext ? `KONTEKST: ${announcement.searchContext}` : null,
      locationContext ? `LOKALIZACJA: ${locationContext}` : null,
      `\nPOZYCJE:\n${itemsContext}`,
      attachmentsContext,
    ]
      .filter(Boolean)
      .join("\n");

    const compactUserMessage = [
      `OGŁOSZENIE: ${announcement.title}`,
      announcement.description ? `OPIS: ${announcement.description}` : null,
      announcement.searchContext ? `KONTEKST: ${announcement.searchContext}` : null,
      locationContext ? `LOKALIZACJA: ${locationContext}` : null,
      `\nSKRÓT POZYCJI:\n${itemsContext.slice(0, 2_500)}`,
      attachmentTexts.length > 0
        ? `\nNAJWAŻNIEJSZE ZAŁĄCZNIKI:\n${attachmentTexts.join("\n\n---\n\n").slice(0, 12_000)}`
        : "\nBrak dostępnych załączników tekstowych do analizy.",
      "Zwróć finalny raport w Markdown z podanymi sekcjami. Jeśli czegoś nie da się potwierdzić z dokumentów, napisz to wprost.",
    ]
      .filter(Boolean)
      .join("\n");

    let report = this.buildFallbackReport(
      {
        title: announcement.title,
        description: announcement.description,
        searchContext: announcement.searchContext,
      },
      rawData,
      locationContext,
      itemsContext,
      attachmentTexts.length,
    );
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let llmUsed = false;
    let llmFailureReason: string | null = null;

    if (!apiKey) {
      this.logger.warn("OPENAI_API_KEY not set — using fallback announcement report");
      llmFailureReason = "OPENAI_API_KEY not set";
    } else {
      try {
        const chat = createChatModel(apiKey, chatModel, 8_000);

        const response = await chat.invoke([
          new SystemMessage(REPORT_SYSTEM_PROMPT),
          new HumanMessage(userMessage),
        ]);

        let generated = extractMessageText(response.content);
        const finishReason = (response.response_metadata as Record<string, unknown> | undefined)?.finish_reason;
        const tokenUsageMeta = (response.response_metadata as Record<string, unknown> | undefined)?.tokenUsage as
          | Record<string, unknown>
          | undefined;
        promptTokens = Number(tokenUsageMeta?.promptTokens ?? 0);
        completionTokens = Number(tokenUsageMeta?.completionTokens ?? 0);
        totalTokens = Number(tokenUsageMeta?.totalTokens ?? promptTokens + completionTokens);

        if (!generated) {
          this.logger.warn(
            `Primary report prompt returned empty content for ${announcementId}; retrying with compact prompt (finish_reason=${String(finishReason ?? "unknown")})`,
          );

          const retryChat = createChatModel(apiKey, chatModel, 8_000);
          const retryResponse = await retryChat.invoke([
            new SystemMessage(COMPACT_REPORT_SYSTEM_PROMPT),
            new HumanMessage(compactUserMessage),
          ]);

          generated = extractMessageText(retryResponse.content);

          const retryUsageMeta = (retryResponse.response_metadata as Record<string, unknown> | undefined)?.tokenUsage as
            | Record<string, unknown>
            | undefined;
          promptTokens += Number(retryUsageMeta?.promptTokens ?? 0);
          completionTokens += Number(retryUsageMeta?.completionTokens ?? 0);
          totalTokens += Number(retryUsageMeta?.totalTokens ?? 0);
        }

        if (generated.length > 0) {
          report = generated;
          llmUsed = true;
        } else {
          llmFailureReason = "LLM returned empty content";
        }
      } catch (error) {
        llmFailureReason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Report LLM generation failed for ${announcementId}: ${llmFailureReason}`);
      }
    }

    // ── 4. Zapisz wynik ──────────────────────────────────────────────────────
    await this.prisma.announcement.update({
      where: { id: announcementId },
      data: {
        detailedReport: report,
        embeddingStatus: "PENDING",
      },
    });

    await this.embeddingService.enqueueAnnouncementEmbedding(announcementId);

    this.logger.log(`Report generated for announcement ${announcementId} (${report.length} chars)`);

    if (logId) {
      const aiOperations = [
        buildAiOperationLog({
          name: "announcement-report",
          provider: "OPENAI",
          model: chatModel,
          ...(promptTokens || completionTokens
            ? { promptTokens, completionTokens, totalTokens }
            : {}),
        }),
      ];

      await this.jobLogger.finish({
        logId,
        status: "COMPLETED",
        result: {
          announcementId,
          title: announcement.title,
          reportLength: report.length,
          attachmentsProcessed: attachmentTexts.length,
          llmUsed,
          reembedQueued: true,
          previousEmbeddingStatus: announcement.embeddingStatus,
          aiOperations,
          ...(llmFailureReason ? { llmFailureReason } : {}),
          ...(promptTokens || completionTokens
            ? {
                promptTokens,
                completionTokens,
                totalTokens,
                estimatedCostUsd: aiOperations[0]?.estimatedCostUsd ?? null,
              }
            : {}),
        },
      });
    }

    return report;
  }

  private buildFallbackReport(
    announcement: { title: string; description: string | null; searchContext: string },
    rawData: ReportRawData | null,
    locationContext: string | null,
    itemsContext: string,
    attachmentsProcessed: number,
  ): string {
    const orders = Array.isArray(rawData?.orders) ? rawData.orders : [];
    const estimatedValues = orders
      .map((order) => order.estimated_value ?? order.order_items?.find((item) => item.estimated_value != null)?.estimated_value ?? null)
      .map((value) => (value == null ? null : Number(String(value).replace(/\s/g, "").replace(",", "."))))
      .filter((value): value is number => Number.isFinite(value));

    const estimatedRange =
      estimatedValues.length > 0
        ? `${Math.min(...estimatedValues).toLocaleString("pl-PL")} – ${Math.max(...estimatedValues).toLocaleString("pl-PL")} PLN netto`
        : "Brak jednoznacznej wartości w danych źródłowych — wymagana ręczna estymacja.";

    return [
      "## Przedmiot zamówienia",
      announcement.title,
      announcement.description ?? "Brak dodatkowego opisu w rekordzie ogłoszenia.",
      "",
      "## Lokalizacja realizacji",
      locationContext ?? "Brak jednoznacznej lokalizacji w danych źródłowych — wymagana ręczna weryfikacja.",
      "",
      "## Szczegółowy zakres prac",
      itemsContext,
      "",
      "## Wymagane produkty, materiały i technologie",
      announcement.searchContext || "Brak dodatkowego kontekstu technicznego poza opisem i danymi źródłowymi.",
      "",
      "## Szacunek kosztów",
      estimatedRange,
      "",
      "## Wymagania wobec wykonawcy",
      "Do ręcznej weryfikacji w treści ogłoszenia i załącznikach.",
      "",
      "## Kryteria oceny i warunki handlowe",
      "Do ręcznej weryfikacji w treści ogłoszenia i załącznikach.",
      "",
      "## Terminy",
      "Do ręcznej weryfikacji w treści ogłoszenia.",
      "",
      "## Ryzyka i zalecenia dla wykonawcy",
      `Raport awaryjny wygenerowany bez wsparcia LLM. Przetworzono ${attachmentsProcessed} załącznik(i/ów); zalecana ręczna weryfikacja szczegółów technicznych i wyceny.`,
    ].join("\n");
  }

  private extractLocationContext(
    sourceSystem: string,
    rawData: ReportRawData | null,
    announcement: { title: string; description: string | null; searchContext: string },
  ): string | null {
    const candidates: string[] = [];

    const push = (value: unknown, label?: string) => {
      const normalized = this.cleanLocationValue(value);
      if (!normalized) return;
      candidates.push(label ? `${label}: ${normalized}` : normalized);
    };

    if (sourceSystem === "BAZA_KONKURENCYJNOSCI") {
      push(rawData?.fulfillment_place, "Miejsce realizacji");
    }

    if (sourceSystem === "E_ZAMOWIENIA") {
      push(rawData?.organizationCity, "Miejscowość");
      push(rawData?.organizationProvince, "Województwo");
      push(rawData?.organizationCountry, "Kraj");
      push(rawData?.organizationName, "Zamawiający");
    }

    if (sourceSystem === "PLATFORMA_ZAKUPOWA") {
      push(rawData?.adres_dostawy, "Adres dostawy");
      push(rawData?.firma_wystawiajaca, "Zamawiający");
    }

    const searchContextLocation = this.extractLocationFromSearchContext(announcement.searchContext);
    if (searchContextLocation) {
      candidates.push(searchContextLocation);
    }

    const unique = candidates.filter((value, index, array) => array.indexOf(value) === index);
    return unique.length > 0 ? unique.join(" | ") : null;
  }

  private extractLocationFromSearchContext(searchContext: string): string | null {
    if (!searchContext) return null;

    const parts = searchContext
      .split("|")
      .map((part) => part.trim())
      .filter((part) => /miejscowość|lokalizacja|adres|województwo|miejsce realizacji/i.test(part));

    return parts.length > 0 ? parts.join(" | ") : null;
  }

  private cleanLocationValue(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private buildItemsContext(
    rawData: ReportRawData | null,
    announcement: { title: string; description: string | null; searchContext: string },
  ): string {
    const orders = Array.isArray(rawData?.orders) ? rawData.orders : [];

    if (orders.length === 0) {
      return [
        `[Pozycja 1] ${announcement.title}`,
        announcement.description ? `Opis: ${announcement.description}` : null,
        announcement.searchContext ? `Kontekst: ${announcement.searchContext}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    return orders
      .map((order, index) => {
        const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
        const uniqueCpv = orderItems
          .flatMap((item) => (Array.isArray(item.cpv_items) ? item.cpv_items : []))
          .map((cpv) => [cpv.code, cpv.name].filter(Boolean).join(" ").trim())
          .filter((value, valueIndex, array) => value.length > 0 && array.indexOf(value) === valueIndex);

        const categories = orderItems
          .flatMap((item) => [item.category?.name, item.subcategory?.name])
          .filter((value, valueIndex, array): value is string => !!value && array.indexOf(value) === valueIndex);

        const descriptions = orderItems
          .map((item) => item.description?.trim())
          .filter((value): value is string => !!value && value.length > 0);

        const estimatedValue = order.estimated_value ?? orderItems.find((item) => item.estimated_value != null)?.estimated_value ?? null;

        return [
          `[Pozycja ${index + 1}] ${order.title?.trim() || `Część ${index + 1}`}`,
          categories.length > 0 ? `Kategorie: ${categories.join(", ")}` : null,
          uniqueCpv.length > 0 ? `CPV: ${uniqueCpv.join("; ")}` : null,
          estimatedValue != null ? `Wartość szacunkowa z danych źródłowych: ${String(estimatedValue)} PLN` : null,
          descriptions.length > 0 ? `Opis:\n${descriptions.join("\n\n")}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n---\n\n");
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

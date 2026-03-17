import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Redis } from "ioredis";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { EmbeddingService } from "../embedding/embedding.service.js";
import { AnnouncementsService } from "./announcements.service.js";

const SESSION_PREFIX = "internal-announcement-prompt:";
const SESSION_TTL_SEC = 1800;

const INTERNAL_ANNOUNCEMENT_KINDS = [
  "DOSTAWA",
  "USLUGA",
  "ROBOTY_BUDOWLANE",
  "SZKOLENIE",
  "USLUGA_IT",
  "USLUGA_BADAWCZO_ROZWOJOWA",
  "DORADZTWO",
  "INNE",
] as const;

type InternalAnnouncementKind = (typeof INTERNAL_ANNOUNCEMENT_KINDS)[number];

type CollectedFields = Partial<{
  title: string;
  contractingAuthority: string;
  location: string;
  scope: string;
  requirements: string;
  timeline: string;
  budget: string;
}>;

interface SessionHistory {
  role: "user" | "assistant";
  content: string;
}

interface SessionData {
  collected: CollectedFields;
  history: SessionHistory[];
  pendingFinalAnnouncement?: z.infer<typeof finalAnnouncementSchema> | null;
  pendingSummary?: string | null;
}

const REQUIRED_FIELDS: (keyof CollectedFields)[] = [
  "title",
  "contractingAuthority",
  "location",
  "scope",
  "requirements",
  "timeline",
  "budget",
];

const finalAnnouncementSchema = z.object({
  title: z.string().trim().min(6).max(220),
  description: z.string().trim().min(40).max(4000),
  searchContext: z.string().trim().min(40).max(12_000),
  detailedReport: z.string().trim().min(80).max(24_000),
  location: z.string().trim().min(2).max(220).nullable().optional(),
  contractingAuthority: z.string().trim().min(2).max(220).nullable().optional(),
  kind: z.enum(INTERNAL_ANNOUNCEMENT_KINDS).nullable().optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
});

const aiExtractionSchema = z.object({
  fields: z.object({
    title: z.string().trim().min(3).max(220).nullable().optional(),
    contractingAuthority: z.string().trim().min(2).max(220).nullable().optional(),
    location: z.string().trim().min(2).max(220).nullable().optional(),
    scope: z.string().trim().min(5).max(4000).nullable().optional(),
    requirements: z.string().trim().min(5).max(4000).nullable().optional(),
    timeline: z.string().trim().min(2).max(1200).nullable().optional(),
    budget: z.string().trim().min(2).max(1200).nullable().optional(),
  }),
  isComplete: z.boolean(),
  response: z.string().trim().min(1).max(3000),
  finalAnnouncement: finalAnnouncementSchema.nullable().optional(),
});

type AIExtraction = z.infer<typeof aiExtractionSchema>;

const CONFIRM_CREATE_MESSAGE = "__CONFIRM_INTERNAL_ANNOUNCEMENT__";
const CONFIRM_MESSAGES = new Set([
  "ok",
  "okej",
  "okejka",
  "tak",
  "yes",
  "potwierdzam",
  "zgadza się",
  "zgadza sie",
  "utwórz",
  "utworz",
  "twórz",
  "tworz",
  "stwórz",
  "stworz",
  "zapisz",
  "może być",
  "moze byc",
]);

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

@Injectable()
export class InternalAnnouncementPromptService implements OnModuleDestroy {
  private readonly logger = new Logger(InternalAnnouncementPromptService.name);
  private readonly redis: Redis;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmbeddingService) private readonly embeddingService: EmbeddingService,
    @Inject(AnnouncementsService)
    private readonly announcementsService: AnnouncementsService,
  ) {
    const redisUrl = config.get<string>("REDIS_URL") ?? "redis://127.0.0.1:6380";
    this.redis = new Redis(redisUrl, { lazyConnect: false });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async processMessage(sessionId: string | undefined, userMessage: string) {
    try {
      return await this._processMessage(sessionId, userMessage);
    } catch (err: unknown) {
      const error = err as Error & { status?: number; statusCode?: number };
      const httpStatus = error?.status ?? error?.statusCode;

      if (
        httpStatus === 429
        || error?.message?.includes("exceeded your current quota")
        || error?.message?.includes("Rate limit")
      ) {
        this.logger.warn("OpenAI quota/rate-limit exceeded", error.message);
        throw new ServiceUnavailableException(
          "Usługa AI jest chwilowo niedostępna (limit zapytań). Spróbuj ponownie za chwilę.",
        );
      }

      this.logger.error(
        "processMessage failed",
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException("Nie udało się przetworzyć ogłoszenia wewnętrznego.");
    }
  }

  private async _processMessage(sessionId: string | undefined, userMessage: string) {
    const sid = sessionId ?? crypto.randomUUID();
    const session = await this.loadSession(sid);

    if (session.pendingFinalAnnouncement && this.isConfirmationMessage(userMessage)) {
      session.history.push({ role: "user", content: userMessage });
      session.history.push({ role: "assistant", content: "Jasne — zapisuję ogłoszenie." });

      const announcement = await this.createInternalAnnouncement(
        sid,
        session.collected,
        session.history,
        session.pendingFinalAnnouncement,
      );
      await this.redis.del(`${SESSION_PREFIX}${sid}`);

      return {
        status: "created" as const,
        announcement,
      };
    }

    if (session.pendingFinalAnnouncement) {
      session.pendingFinalAnnouncement = null;
      session.pendingSummary = null;
    }

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const chatModel = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5-mini";
    const missingFields = this.getMissingFields(session.collected);

    const messages = [
      new SystemMessage(this.buildSystemPrompt(session.collected, missingFields)),
      ...session.history.map((message) =>
        message.role === "user"
          ? new HumanMessage(message.content)
          : new AIMessage(message.content),
      ),
      new HumanMessage(userMessage),
    ];

    const llm = new ChatOpenAI({
      apiKey,
      model: chatModel,
      ...(chatModel.startsWith("gpt-5") ? {} : { temperature: 0 }),
      modelKwargs: { response_format: { type: "json_object" } },
    });

    const aiResponse = await llm.invoke(messages);
    const raw = typeof aiResponse.content === "string"
      ? aiResponse.content
      : JSON.stringify(aiResponse.content);

    let extraction: AIExtraction;
    try {
      extraction = aiExtractionSchema.parse(JSON.parse(raw));
    } catch {
      this.logger.error("Failed to parse internal announcement AI response", raw);
      throw new Error("AI response parsing failed");
    }

    const updated = this.mergeCollectedFields(session.collected, extraction.fields);

    session.history.push({ role: "user", content: userMessage });
    session.history.push({ role: "assistant", content: extraction.response });

    await this.saveSession(sid, {
      collected: updated,
      history: session.history,
      pendingFinalAnnouncement: null,
      pendingSummary: null,
    });

    const stillMissing = this.getMissingFields(updated);
    const isActuallyComplete = stillMissing.length === 0;

    if (isActuallyComplete) {
      const finalPayload = extraction.finalAnnouncement ?? this.buildFallbackAnnouncement(updated);
      const summary = this.buildReviewSummary(updated, finalPayload);

      session.history.push({ role: "assistant", content: summary });
      await this.saveSession(sid, {
        collected: updated,
        history: session.history,
        pendingFinalAnnouncement: finalPayload,
        pendingSummary: summary,
      });

      return {
        status: "review" as const,
        sessionId: sid,
        summary,
        collectedData: updated,
      };
    }

    return {
      status: "question" as const,
      sessionId: sid,
      question: extraction.response,
      collectedData: updated,
    };
  }

  private mergeCollectedFields(current: CollectedFields, incoming: AIExtraction["fields"]): CollectedFields {
    const updated: CollectedFields = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      const normalized = normalizeOptionalText(value);
      if (normalized) {
        updated[key as keyof CollectedFields] = normalized;
      }
    }
    return updated;
  }

  private getMissingFields(collected: CollectedFields) {
    return REQUIRED_FIELDS.filter((field) => !normalizeOptionalText(collected[field]));
  }

  private buildSystemPrompt(collected: CollectedFields, missingFields: string[]) {
    const fieldLabels: Record<keyof CollectedFields, string> = {
      title: "Tytuł / nazwa zapytania",
      contractingAuthority: "Kto zgłasza zapytanie / zamawiający",
      location: "Lokalizacja realizacji",
      scope: "Co ma być dostarczone lub wykonane",
      requirements: "Kluczowe wymagania i parametry",
      timeline: "Termin realizacji / ważne terminy",
      budget: "Budżet albo informacja, że wykonawca ma go oszacować",
    };

    const collectedSummary = Object.keys(collected).length > 0
      ? Object.entries(collected)
          .map(([key, value]) => `- ${fieldLabels[key as keyof CollectedFields] ?? key}: ${JSON.stringify(value)}`)
          .join("\n")
      : "- brak danych";

    const missingSummary = missingFields.length > 0
      ? missingFields.map((field) => `- ${fieldLabels[field as keyof CollectedFields] ?? field}`).join("\n")
      : "- komplet";

    return `Jesteś asystentem Leadfinder pomagającym stworzyć WEWNĘTRZNE ogłoszenie zakupowe w języku polskim.
Twoim celem jest zebrać tyle informacji, aby wykonawca mógł przygotować sensowną wycenę i odpowiedź.

  Styl rozmowy:
  - Pisz po polsku, naturalnie, przyjaźnie i luźno.
  - Nie brzmisz urzędowo ani formalistycznie.
  - Nie używaj sztywnych sformułowań typu "proszę wskazać" albo "uprzejmie proszę o doprecyzowanie".
  - Możesz używać lekkiego humoru i krótkich, naturalnych wstawek, ale bez przesady i bez robienia z rozmowy stand-upu.
  - Przed pytaniem możesz bardzo krótko nawiązać do poprzedniej odpowiedzi, np. "Super", "Świetnie", "No i pięknie", "WOW", "Zazdro" — o ile pasuje do kontekstu.
  - Jeśli czegoś nie wiesz, po prostu dopytaj prostym pytaniem.
  - Nie wymyślaj żadnych faktów. Używaj wyłącznie informacji od użytkownika albo takich, które jednoznacznie wynikają z rozmowy.
  - Jeśli coś szacujesz albo dopowiadasz roboczo, wyraźnie zaznacz, że to szacunek i poproś o potwierdzenie.

Aktualnie zebrane dane:
${collectedSummary}

Brakujące lub wymagające doprecyzowania obszary:
${missingSummary}

Zasady rozmowy:
1. Analizuj całą historię rozmowy i wyciągaj dane również z wcześniejszych wiadomości.
2. Zadawaj TYLKO jedno krótkie pytanie na raz o największą lukę informacyjną.
3. Jeśli użytkownik nie zna budżetu, dopuść odpowiedź typu "do oszacowania przez wykonawcę".
4. Gdy informacji jest już dość, ustaw isComplete=true i przygotuj finalAnnouncement, ale bez dopowiadania brakujących faktów od siebie.
5. finalAnnouncement ma być gotowy do zapisania w systemie i zawierać:
   - title: finalny tytuł ogłoszenia
   - description: zwięzły opis do listy
   - searchContext: bogaty tekst pod embedding / wyszukiwarkę
   - detailedReport: pełne ogłoszenie w Markdown z sekcjami:
     ## Przedmiot zamówienia
     ## Zakres prac lub dostaw
     ## Wymagania i parametry
     ## Lokalizacja i organizacja realizacji
     ## Budżet i model rozliczenia
     ## Terminy
     ## Dodatkowe uwagi dla wykonawcy
   - location, contractingAuthority, kind, deadlineAt (opcjonalnie jeśli da się wywnioskować)
6. Jeśli danych jeszcze brakuje, finalAnnouncement ustaw na null.
7. Jeżeli jakaś informacja jest tylko przypuszczeniem lub szerokim szacunkiem, wpisz ją ostrożnie i dopilnuj, aby response prosiło użytkownika o potwierdzenie.
8. finalAnnouncement nie może zawierać niczego, czego użytkownik nie podał albo co nie wynika wprost z kontekstu rozmowy.
9. Jeśli użytkownik opisuje coś, co będzie montowane, wykonywane na miejscu, wdrażane fizycznie albo zależy od warunków lokalnych, możesz zapytać o zdjęcie miejsca, szkic, koncepcję albo inspiracje — ale tylko wtedy, gdy realnie pomoże to w doprecyzowaniu zakresu.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em:
{
  "fields": {
    "title": null lub string,
    "contractingAuthority": null lub string,
    "location": null lub string,
    "scope": null lub string,
    "requirements": null lub string,
    "timeline": null lub string,
    "budget": null lub string
  },
  "isComplete": boolean,
  "response": "krótka odpowiedź dla użytkownika",
  "finalAnnouncement": null lub {
    "title": string,
    "description": string,
    "searchContext": string,
    "detailedReport": string,
    "location": string | null,
    "contractingAuthority": string | null,
    "kind": "DOSTAWA" | "USLUGA" | "ROBOTY_BUDOWLANE" | "SZKOLENIE" | "USLUGA_IT" | "USLUGA_BADAWCZO_ROZWOJOWA" | "DORADZTWO" | "INNE" | null,
    "deadlineAt": ISO datetime lub null
  }
}`;
  }

  private buildReviewSummary(
    collected: CollectedFields,
    finalAnnouncement: z.infer<typeof finalAnnouncementSchema>,
  ) {
    const lines = [
      "Mam robocze podsumowanie. Sprawdź proszę, czy wszystko się zgadza:",
      `- Tytuł: ${normalizeOptionalText(finalAnnouncement.title) ?? normalizeOptionalText(collected.title) ?? "brak"}`,
      `- Zamawiający: ${normalizeOptionalText(finalAnnouncement.contractingAuthority) ?? normalizeOptionalText(collected.contractingAuthority) ?? "brak"}`,
      `- Lokalizacja: ${normalizeOptionalText(finalAnnouncement.location) ?? normalizeOptionalText(collected.location) ?? "brak"}`,
      `- Zakres: ${normalizeOptionalText(collected.scope) ?? "brak"}`,
      `- Wymagania: ${normalizeOptionalText(collected.requirements) ?? "brak"}`,
      `- Terminy: ${normalizeOptionalText(collected.timeline) ?? "brak"}`,
      `- Budżet: ${normalizeOptionalText(collected.budget) ?? "brak"}`,
      "",
      "Jeśli jest ok, kliknij utworzenie albo napisz po prostu \"utwórz\". Jeśli coś poprawić, napisz co zmienić.",
    ];

    return lines.join("\n");
  }

  private isConfirmationMessage(message: string) {
    const normalized = normalizeOptionalText(message)?.toLocaleLowerCase("pl-PL");
    if (!normalized) return false;
    return normalized === CONFIRM_CREATE_MESSAGE.toLocaleLowerCase("pl-PL") || CONFIRM_MESSAGES.has(normalized);
  }

  private buildFallbackAnnouncement(collected: CollectedFields) {
    const title = normalizeOptionalText(collected.title) ?? "Ogłoszenie wewnętrzne";
    const location = normalizeOptionalText(collected.location);
    const contractingAuthority = normalizeOptionalText(collected.contractingAuthority);
    const scope = normalizeOptionalText(collected.scope) ?? "Zakres do uzupełnienia";
    const requirements = normalizeOptionalText(collected.requirements) ?? "Wymagania do doprecyzowania";
    const timeline = normalizeOptionalText(collected.timeline) ?? "Termin do ustalenia";
    const budget = normalizeOptionalText(collected.budget) ?? "Budżet do oszacowania przez wykonawcę";

    return {
      title,
      description: `${scope}. Wymagania: ${requirements}`.slice(0, 4000),
      searchContext: [
        `Tytuł: ${title}`,
        contractingAuthority ? `Zamawiający: ${contractingAuthority}` : null,
        location ? `Lokalizacja: ${location}` : null,
        `Zakres: ${scope}`,
        `Wymagania: ${requirements}`,
        `Terminy: ${timeline}`,
        `Budżet: ${budget}`,
      ].filter(Boolean).join(" | "),
      detailedReport: [
        "## Przedmiot zamówienia",
        scope,
        "",
        "## Zakres prac lub dostaw",
        scope,
        "",
        "## Wymagania i parametry",
        requirements,
        "",
        "## Lokalizacja i organizacja realizacji",
        [contractingAuthority ? `Zamawiający: ${contractingAuthority}` : null, location ? `Lokalizacja: ${location}` : null]
          .filter(Boolean)
          .join("\n") || "Do ustalenia",
        "",
        "## Budżet i model rozliczenia",
        budget,
        "",
        "## Terminy",
        timeline,
        "",
        "## Dodatkowe uwagi dla wykonawcy",
        "Przed złożeniem oferty potwierdź zakres, założenia i ryzyka realizacyjne.",
      ].join("\n"),
      location,
      contractingAuthority,
      kind: "INNE" as InternalAnnouncementKind,
      deadlineAt: null,
    };
  }

  private async createInternalAnnouncement(
    sessionId: string,
    collected: CollectedFields,
    history: SessionHistory[],
    finalAnnouncement: z.infer<typeof finalAnnouncementSchema>,
  ) {
    const id = crypto.randomUUID();
    const now = new Date();
    const rawTitle = normalizeOptionalText(collected.title);
    const finalTitle = normalizeOptionalText(finalAnnouncement.title) ?? rawTitle ?? "Ogłoszenie wewnętrzne";
    const storedTitle = rawTitle ?? finalTitle;
    const aiTitle = finalTitle !== storedTitle ? finalTitle : null;
    const externalId = `internal-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${id.slice(0, 8)}`;
    const deadlineAt = finalAnnouncement.deadlineAt ? new Date(finalAnnouncement.deadlineAt) : null;
    const rawData = {
      type: "internal-announcement",
      createdVia: "prompt",
      promptSessionId: sessionId,
      collected,
      finalAnnouncement,
      conversation: history.map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
    } satisfies Prisma.InputJsonValue;

    await this.prisma.announcement.create({
      data: {
        id,
        sourceSystem: "INTERNAL",
        externalId,
        partIndex: 0,
        title: storedTitle,
        aiTitle,
        description: finalAnnouncement.description,
        url: `/announcements?id=${id}`,
        status: "OPEN",
        publishedAt: now,
        deadlineAt: deadlineAt && !Number.isNaN(deadlineAt.getTime()) ? deadlineAt : null,
        location: normalizeOptionalText(finalAnnouncement.location),
        contractingAuthority: normalizeOptionalText(finalAnnouncement.contractingAuthority),
        searchContext: finalAnnouncement.searchContext,
        kind: finalAnnouncement.kind ?? "INNE",
        detailedReport: finalAnnouncement.detailedReport,
        embeddingStatus: "PENDING",
        rawData,
      },
    });

    await this.embeddingService.enqueueAnnouncementEmbedding(id);
    return this.announcementsService.findOne(id);
  }

  private async loadSession(sessionId: string): Promise<SessionData> {
    const key = `${SESSION_PREFIX}${sessionId}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      return { collected: {}, history: [], pendingFinalAnnouncement: null, pendingSummary: null };
    }

    try {
      const parsed = JSON.parse(raw) as SessionData;
      return {
        collected: parsed.collected ?? {},
        history: parsed.history ?? [],
        pendingFinalAnnouncement: parsed.pendingFinalAnnouncement ?? null,
        pendingSummary: parsed.pendingSummary ?? null,
      };
    } catch {
      return { collected: {}, history: [], pendingFinalAnnouncement: null, pendingSummary: null };
    }
  }

  private async saveSession(sessionId: string, data: SessionData) {
    const key = `${SESSION_PREFIX}${sessionId}`;
    await this.redis.set(key, JSON.stringify(data), "EX", SESSION_TTL_SEC);
  }
}
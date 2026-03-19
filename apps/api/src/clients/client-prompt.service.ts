import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import { Redis } from "ioredis";
import type { AppEnv } from "../config/env.js";
import type { ClientProfileFields } from "@leadfinder/contracts";
import { ClientsService } from "./clients.service.js";

const SESSION_PREFIX = "client-prompt:";
const SESSION_TTL_SEC = 1800; // 30 min

type CollectedFields = Partial<ClientProfileFields>;

interface SessionHistory {
  role: "user" | "assistant";
  content: string;
}

interface SessionData {
  collected: CollectedFields;
  history: SessionHistory[];
}

const REQUIRED_FIELDS: (keyof ClientProfileFields)[] = [
  "companyName",
  "industry",
  "geographicScope",
  "budgetDescription",
  "contactPersonName",
  "contactPersonRole",
];

interface AIExtraction {
  fields: {
    companyName?: string | null;
    industry?: string | null;
    geographicScope?: "NATIONAL" | "REGIONAL" | "LOCAL" | null;
    geographicDetails?: string | null;
    budgetDescription?: string | null;
    contactPersonName?: string | null;
    contactPersonRole?: string | null;
  };
  isComplete: boolean;
  response: string;
}

@Injectable()
export class ClientPromptService implements OnModuleDestroy {
  private readonly logger = new Logger(ClientPromptService.name);
  private readonly redis: Redis;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
    @Inject(ClientsService) private readonly clientsService: ClientsService,
  ) {
    const redisUrl =
      config.get<string>("REDIS_URL") ?? "redis://127.0.0.1:6380";
    this.redis = new Redis(redisUrl, { lazyConnect: false });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async processMessage(
    sessionId: string | undefined,
    userMessage: string,
  ): Promise<
    | {
        status: "question";
        sessionId: string;
        question: string;
        collectedData: CollectedFields;
      }
    | {
        status: "created";
        client: ReturnType<ClientsService["serializeClient"]>;
        matchCount: number;
      }
  > {
    try {
      return await this._processMessage(sessionId, userMessage);
    } catch (err: unknown) {
      const e = err as Error & { status?: number; statusCode?: number };
      const httpStatus = e?.status ?? e?.statusCode;

      if (
        httpStatus === 429 ||
        e?.message?.includes("exceeded your current quota") ||
        e?.message?.includes("Rate limit")
      ) {
        this.logger.warn("OpenAI quota/rate-limit exceeded", e.message);
        throw new ServiceUnavailableException(
          "Usługa AI jest chwilowo niedostępna (limit zapytań). Spróbuj za chwilę lub sprawdź konfigurację klucza API.",
        );
      }

      this.logger.error(
        "processMessage failed",
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException("Błąd przetwarzania wiadomości.");
    }
  }

  private async _processMessage(
    sessionId: string | undefined,
    userMessage: string,
  ): Promise<
    | {
        status: "question";
        sessionId: string;
        question: string;
        collectedData: CollectedFields;
      }
    | {
        status: "created";
        client: ReturnType<ClientsService["serializeClient"]>;
        matchCount: number;
      }
  > {
    const sid = sessionId ?? crypto.randomUUID();
    const session = await this.loadSession(sid);

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const chatModel =
      this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5.4-nano";

    const missingFields = this.getMissingFields(session.collected);
    const systemPrompt = this.buildSystemPrompt(
      session.collected,
      missingFields,
    );

    const messages = [
      new SystemMessage(systemPrompt),
      ...session.history.map((m) =>
        m.role === "user"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content),
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
    const raw = aiResponse.content as string;

    let extraction: AIExtraction;
    try {
      extraction = JSON.parse(raw) as AIExtraction;
    } catch {
      this.logger.error("Failed to parse AI response", raw);
      throw new Error("AI response parsing failed");
    }

    // Merge non-null extracted fields into session
    const updated: CollectedFields = { ...session.collected };
    const f = extraction.fields ?? {};
    if (f.companyName) updated.companyName = f.companyName;
    if (f.industry) updated.industry = f.industry;
    if (f.geographicScope) updated.geographicScope = f.geographicScope;
    if (f.geographicDetails) updated.geographicDetails = f.geographicDetails;
    if (f.budgetDescription) updated.budgetDescription = f.budgetDescription;
    if (f.contactPersonName) updated.contactPersonName = f.contactPersonName;
    if (f.contactPersonRole) updated.contactPersonRole = f.contactPersonRole;

    // Update history
    session.history.push({ role: "user", content: userMessage });
    session.history.push({ role: "assistant", content: extraction.response });

    // Re-check completeness with updated fields
    const stillMissing = this.getMissingFields(updated);
    const isActuallyComplete = stillMissing.length === 0;

    // Save session
    await this.saveSession(sid, {
      collected: updated,
      history: session.history,
    });

    if (isActuallyComplete) {
      // Validate that geographicDetails is present if needed
      const profile = updated as ClientProfileFields;
      if (
        (profile.geographicScope === "REGIONAL" ||
          profile.geographicScope === "LOCAL") &&
        !profile.geographicDetails
      ) {
        const question =
          "Podaj proszę szczegóły zasięgu geograficznego (np. 'województwo mazowieckie' lub 'Kraków + promień 50 km').";
        return {
          status: "question",
          sessionId: sid,
          question,
          collectedData: updated,
        };
      }

      // Delete session and create client
      await this.redis.del(`${SESSION_PREFIX}${sid}`);
      const client = await this.clientsService.createClient(profile);
      return { status: "created", client, matchCount: 0 };
    }

    return {
      status: "question",
      sessionId: sid,
      question: extraction.response,
      collectedData: updated,
    };
  }

  private getMissingFields(collected: CollectedFields): string[] {
    return REQUIRED_FIELDS.filter((f) => !collected[f]);
  }

  private buildSystemPrompt(
    collected: CollectedFields,
    missingFields: string[],
  ): string {
    const fieldLabels: Record<string, string> = {
      companyName: "Nazwa firmy",
      industry: "Branża/Specjalizacja",
      geographicScope: "Zasięg geograficzny (NATIONAL/REGIONAL/LOCAL)",
      geographicDetails: "Szczegóły zasięgu",
      budgetDescription: "Skala/Budżet zamówień",
      contactPersonName: "Imię i nazwisko osoby kontaktowej",
      contactPersonRole: "Rola w firmie",
    };

    const collectedSummary =
      Object.keys(collected).length > 0
        ? Object.entries(collected)
            .map(([k, v]) => `  ${fieldLabels[k] ?? k}: ${JSON.stringify(v)}`)
            .join("\n")
        : "  (brak danych)";

    const missingSummary = missingFields
      .map((f) => `  - ${fieldLabels[f] ?? f}`)
      .join("\n");

    return `Jesteś asystentem Leadfinder pomagającym zebrać profil firmy klienta.
Prowadź naturalną, przyjazną rozmowę w języku polskim.

Zbierasz następujące informacje:
- companyName: Nazwa firmy
- industry: Branża/Specjalizacja SZCZEGÓŁOWA (np. "wdrażanie systemów ERP i szkoleń SAP", nie samo "IT")
- geographicScope: Zasięg — NATIONAL (cała Polska), REGIONAL (województwo/region), LOCAL (miasto/promień km)
- geographicDetails: Dokładny opis zasięgu gdy scope to REGIONAL lub LOCAL
- budgetDescription: Skala zamówień (np. "małe do 50k PLN", "średnie 100k–500k PLN", "duże powyżej 1 mln PLN")
- contactPersonName: Imię i nazwisko osoby kontaktowej
- contactPersonRole: Rola tej osoby w firmie (np. właściciel, prezes, handlowiec)

Aktualnie zebrane dane:
${collectedSummary}

Brakujące pola:
${missingFields.length > 0 ? missingSummary : "  (komplet danych — możemy tworzyć profil)"}

Zasady:
1. Analizuj całą historię rozmowy i wyciągaj pola ze wszystkich wiadomości
2. Zadaj JEDNO krótkie pytanie o pierwsze brakujące pole
3. Potwierdź krótko to, co użytkownik podał, zanim zapytasz o kolejną rzecz
4. Gdy masz wszystkie pola — ustaw isComplete=true i napisz podsumowanie bez pytania

Odpowiedz WYŁĄCZNIE w formacie JSON (bez markdown):
{
  "fields": {
    "companyName": null lub string,
    "industry": null lub string,
    "geographicScope": null lub "NATIONAL" lub "REGIONAL" lub "LOCAL",
    "geographicDetails": null lub string,
    "budgetDescription": null lub string,
    "contactPersonName": null lub string,
    "contactPersonRole": null lub string
  },
  "isComplete": boolean,
  "response": "Tekst odpowiedzi do użytkownika (potwierdzenie + następne pytanie lub podsumowanie)"
}`;
  }

  private async loadSession(sessionId: string): Promise<SessionData> {
    const key = `${SESSION_PREFIX}${sessionId}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      return { collected: {}, history: [] };
    }
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return { collected: {}, history: [] };
    }
  }

  private async saveSession(
    sessionId: string,
    data: SessionData,
  ): Promise<void> {
    const key = `${SESSION_PREFIX}${sessionId}`;
    await this.redis.set(key, JSON.stringify(data), "EX", SESSION_TTL_SEC);
  }
}

import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import { AppEmbeddings } from "../common/embeddings.js";

interface MatchRow {
  announcement_item_id: string;
  similarity: number;
  title: string;
  description: string | null;
  keyword_hits?: number;
}

const MATCH_THRESHOLD = 0.35;
const MATCH_LIMIT = 50;
const NEGATIVE_KEYWORD_PENALTY = 0.12; // sprowadza dopasowanie do ~12% oryginalnego score
const MAX_SYNTHETIC_ANNOUNCEMENT_CHARS = 8_000;
const MIN_KEYWORD_LENGTH = 4;
const MAX_FALLBACK_KEYWORDS = 12;

const STOPWORDS = new Set([
  "oraz",
  "przedmiot",
  "zamówienia",
  "zamowienia",
  "zakres",
  "warunki",
  "realizacji",
  "wobec",
  "wykonawcy",
  "dostawa",
  "dostawy",
  "usługa",
  "usluga",
  "usługi",
  "uslugi",
  "roboty",
  "budżet",
  "budzet",
  "skala",
  "projekt",
  "firma",
  "klienta",
  "publicznych",
  "publiczne",
  "całej",
  "polsce",
  "polska",
  "terenie",
  "wymagania",
  "słowa",
  "slowa",
  "kluczowe",
  "frazy",
  "równoważne",
  "rownowazne",
  "poza",
  "zakresem",
  "wdrożenie",
  "wdrozenia",
  "kompleksowe",
  "świadczenie",
  "swiadczenie",
  "montaz",
  "montaż",
  "instalacja",
  "instalacji",
  "projektu",
  "budowlanego",
  "ramach",
  "systemu",
  "systemow",
  "systemów",
  "male",
  "małych",
  "malych",
  "przedsiebiorstw",
  "przedsiębiorstw",
  "instytucji",
  "sprzetu",
  "sprzętu",
  "uslug",
  "usług",
  "wdrozenie",
  "wdrożenie",
  "wdrozenia",
  "wdrożenia",
]);

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function applyNegativePenalty(row: MatchRow, negativeKeywords: string[]): boolean {
  if (negativeKeywords.length === 0) return false;
  const haystack = `${row.title} ${row.description ?? ""}`.toLowerCase();
  return negativeKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

@Injectable()
export class ClientMatchingService {
  private readonly logger = new Logger(ClientMatchingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
  ) {}

  async matchClient(clientId: string): Promise<number> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        companyName: true,
        industry: true,
        geographicScope: true,
        geographicDetails: true,
        budgetDescription: true,
        contactPersonName: true,
        contactPersonRole: true,
        profileSummary: true,
        negativeKeywords: true,
      },
    });

    if (!client) throw new Error(`Client not found: ${clientId}`);

    this.logger.debug(
      `Generating synthetic announcement embedding for client: ${client.companyName}`,
    );

    const syntheticAnnouncementText = await this.generateSyntheticAnnouncement(client);

    const embedder = new AppEmbeddings(this.config);
    const vector = await embedder.embedQuery(syntheticAnnouncementText);
    const vectorStr = `[${vector.join(",")}]`;

    await this.prisma.$executeRaw`
      UPDATE clients
      SET
        "profileEmbedding" = ${vectorStr}::vector,
        "syntheticAnnouncementText" = ${syntheticAnnouncementText},
        "updatedAt" = NOW()
      WHERE id = ${clientId}::uuid
    `;

    const fallbackKeywords = this.extractFallbackKeywords(client, syntheticAnnouncementText);
    let rows = fallbackKeywords.length > 0
      ? await this.findKeywordFallbackMatches(vectorStr, fallbackKeywords)
      : [];

    if (rows.length > 0) {
      this.logger.log(
        `Keyword-first matching for client "${client.companyName}" using keywords: ${fallbackKeywords.join(", ")}`,
      );
    }

    if (rows.length === 0) {
      rows = await this.prisma.$queryRaw<MatchRow[]>`
      SELECT
        ai.id AS announcement_item_id,
        (1 - (ai.embedding <=> ${vectorStr}::vector)) AS similarity,
        ai.title,
        ai.description
      FROM announcement_items ai
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND ai.embedding IS NOT NULL
        AND (1 - (ai.embedding <=> ${vectorStr}::vector)) >= ${MATCH_THRESHOLD}
      ORDER BY ai.embedding <=> ${vectorStr}::vector
      LIMIT ${MATCH_LIMIT}
      `;
    }

    const negativeKeywords: string[] = client.negativeKeywords ?? [];

    if (negativeKeywords.length > 0) {
      this.logger.debug(
        `Applying negative keyword penalty for ${negativeKeywords.length} exclusion(s): [${negativeKeywords.join(", ")}]`,
      );
    }

    this.logger.log(
      `Found ${rows.length} candidate matches for client "${client.companyName}"`,
    );

    const retainedIds = new Set<string>();
    let penalized = 0;
    for (const row of rows) {
      retainedIds.add(row.announcement_item_id);
      const isPenalized = applyNegativePenalty(row, negativeKeywords);
      const finalSimilarity = isPenalized
        ? Number(row.similarity) * NEGATIVE_KEYWORD_PENALTY
        : Number(row.similarity);

      if (isPenalized) penalized++;

      await this.prisma.clientMatch.upsert({
        where: {
          clientId_announcementItemId: {
            clientId,
            announcementItemId: row.announcement_item_id,
          },
        },
        create: {
          clientId,
          announcementItemId: row.announcement_item_id,
          similarity: finalSimilarity,
          status: "NEW",
        },
        update: {
          similarity: finalSimilarity,
          updatedAt: new Date(),
        },
      });
    }

    if (retainedIds.size > 0) {
      await this.prisma.clientMatch.deleteMany({
        where: {
          clientId,
          announcementItemId: { notIn: Array.from(retainedIds) },
        },
      });
    } else {
      await this.prisma.clientMatch.deleteMany({ where: { clientId } });
    }

    if (penalized > 0) {
      this.logger.log(
        `Penalized ${penalized}/${rows.length} matches due to negative keyword exclusions`,
      );
    }

    return rows.length;
  }

  private async generateSyntheticAnnouncement(client: {
    companyName: string;
    industry: string;
    geographicScope: "NATIONAL" | "REGIONAL" | "LOCAL";
    geographicDetails: string | null;
    budgetDescription: string;
    contactPersonName: string;
    contactPersonRole: string;
    profileSummary: string;
    negativeKeywords: string[];
  }): Promise<string> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY") ?? "";
    const scopeLabel =
      client.geographicScope === "NATIONAL"
        ? "cała Polska"
        : client.geographicScope === "REGIONAL"
          ? "regionalny"
          : "lokalny";
    const location = client.geographicDetails
      ? `${scopeLabel} (${client.geographicDetails})`
      : scopeLabel;
    const exclusions = client.negativeKeywords.length > 0
      ? client.negativeKeywords.join(", ")
      : "brak jawnych wykluczeń";

    if (!apiKey || !apiKey.startsWith("sk-") || apiKey.includes("xxx")) {
      return this.buildFallbackSyntheticAnnouncement(client, location, exclusions);
    }

    const chatModel = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    const llm = new ChatOpenAI({ apiKey, model: chatModel, temperature: 0.2, maxTokens: 1_500 });

    const prompt = `Jesteś ekspertem od polskich zamówień publicznych. Na podstawie profilu klienta wygeneruj SYNTETYCZNE OGŁOSZENIE, na które ta firma idealnie chciałaby odpowiedzieć.

To ma być tekst do embeddingu i dopasowania semantycznego do realnych announcement_items.
Ma być maksymalnie precyzyjny, bogaty w terminologię przetargową, ale bez lania wody.

PROFIL KLIENTA
- Firma: ${client.companyName}
- Branża/specjalizacja: ${client.industry}
- Zasięg geograficzny: ${location}
- Budżet / skala zleceń: ${client.budgetDescription}
- Osoba kontaktowa: ${client.contactPersonName} (${client.contactPersonRole})
- Wykluczenia: ${exclusions}
- Krótki profil: ${client.profileSummary}

WYMAGANIA WYJŚCIA
- Pisz po polsku.
- Wygeneruj jedno syntetyczne ogłoszenie odpowiadające JEDNEJ typowej części / itemowi.
- Użyj struktury Markdown z sekcjami dokładnie:
## Tytuł
## Przedmiot zamówienia
## Zakres prac / dostaw / usług
## Wymagania wobec wykonawcy
## Termin i warunki realizacji
## Budżet i skala
## Słowa kluczowe i frazy równoważne
## Poza zakresem
- Dodaj bogate słownictwo branżowe, synonimy, język OPZ/SWZ/SIWZ i frazy podobne do realnych ogłoszeń.
- Uwzględnij tylko to, czego firma realnie szuka.
- W sekcji "Poza zakresem" wpisz pozycje, których firma nie chce realizować.
- Nie pisz o samej firmie jako oferencie — opisz zamówienie, na które firma chce odpowiedzieć.
- Maksymalna długość: około 700-900 słów.`;

    try {
      const response = await llm.invoke([new HumanMessage(prompt)]);
      const content = typeof response.content === "string" ? response.content.trim() : "";
      if (content.length >= 200) {
        return content.slice(0, MAX_SYNTHETIC_ANNOUNCEMENT_CHARS);
      }
    } catch (err) {
      this.logger.warn(
        `Synthetic announcement generation failed for ${client.companyName}: ${String(err)}`,
      );
    }

    return this.buildFallbackSyntheticAnnouncement(client, location, exclusions);
  }

  private buildFallbackSyntheticAnnouncement(
    client: {
      companyName: string;
      industry: string;
      budgetDescription: string;
      profileSummary: string;
      negativeKeywords: string[];
    },
    location: string,
    exclusions: string,
  ): string {
    return [
      "## Tytuł",
      `${client.industry} — syntetyczne ogłoszenie dopasowane do profilu klienta ${client.companyName}`,
      "",
      "## Przedmiot zamówienia",
      `Zamówienie odpowiadające profilowi branżowemu klienta w obszarze: ${client.industry}. Lokalizacja realizacji: ${location}.`,
      "",
      "## Zakres prac / dostaw / usług",
      client.profileSummary,
      "",
      "## Wymagania wobec wykonawcy",
      `Wykonawca powinien posiadać doświadczenie adekwatne do zakresu ${client.industry}, zdolność realizacji w modelu odpowiadającym budżetowi ${client.budgetDescription}, oraz kompetencje branżowe typowe dla postępowań zakupowych i przetargowych.`,
      "",
      "## Termin i warunki realizacji",
      `Warunki realizacji powinny być realistyczne dla projektów w segmencie ${client.industry}, z jasnym harmonogramem, wymaganiami odbiorowymi i warunkami współpracy w obszarze ${location}.`,
      "",
      "## Budżet i skala",
      client.budgetDescription,
      "",
      "## Słowa kluczowe i frazy równoważne",
      `${client.industry}, wykonawca, realizacja zamówienia, OPZ, SWZ, SIWZ, przedmiot zamówienia, warunki udziału, wymagania techniczne, zakres realizacji, oferta, kryteria oceny, doświadczenie, referencje, harmonogram, odbiór, wdrożenie, usługa, dostawa, roboty, utrzymanie, serwis.`,
      "",
      "## Poza zakresem",
      exclusions,
    ].join("\n").slice(0, MAX_SYNTHETIC_ANNOUNCEMENT_CHARS);
  }

  private extractFallbackKeywords(
    client: {
      industry: string;
      profileSummary: string;
      negativeKeywords: string[];
    },
    syntheticAnnouncementText: string,
  ): string[] {
    const titleMatch = syntheticAnnouncementText.match(/## Tytuł\s+([^\n]+)/i);
    const titleLine = titleMatch?.[1] ?? "";

    const baseText = [client.industry, titleLine]
      .join(" ")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, " ")
      .replace(/cpv\s*\d[\d-]*/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ");

    const frequencies = new Map<string, number>();
    for (const token of baseText.split(/\s+/)) {
      const keyword = token.trim();
      if (
        keyword.length < MIN_KEYWORD_LENGTH ||
        STOPWORDS.has(keyword) ||
        client.negativeKeywords.some((negative) => negative.toLowerCase() === keyword)
      ) {
        continue;
      }

      frequencies.set(keyword, (frequencies.get(keyword) ?? 0) + 1);
    }

    return [...frequencies.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .map(([keyword]) => keyword)
      .slice(0, MAX_FALLBACK_KEYWORDS);
  }

  private async findKeywordFallbackMatches(
    vectorStr: string,
    keywords: string[],
  ): Promise<MatchRow[]> {
    const safeKeywords = keywords
      .map((keyword) => escapeSqlLiteral(keyword.trim().toLowerCase()))
      .filter((keyword) => keyword.length >= MIN_KEYWORD_LENGTH)
      .slice(0, MAX_FALLBACK_KEYWORDS);

    if (safeKeywords.length === 0) {
      return [];
    }

    const haystack = "lower(coalesce(ai.title, '') || ' ' || coalesce(ai.description, ''))";
    const keywordHits = safeKeywords
      .map((keyword) => `CASE WHEN ${haystack} LIKE '%${keyword}%' THEN 1 ELSE 0 END`)
      .join(" + ");
    const whereAnyKeyword = safeKeywords
      .map((keyword) => `${haystack} LIKE '%${keyword}%'`)
      .join(" OR ");

    return this.prisma.$queryRawUnsafe<MatchRow[]>(`
      SELECT
        ai.id AS announcement_item_id,
        (1 - (ai.embedding <=> '${vectorStr}'::vector)) AS similarity,
        ai.title,
        ai.description,
        (${keywordHits})::int AS keyword_hits
      FROM announcement_items ai
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND ai.embedding IS NOT NULL
        AND (${whereAnyKeyword})
      ORDER BY keyword_hits DESC, ai.embedding <=> '${vectorStr}'::vector
      LIMIT ${MATCH_LIMIT}
    `);
  }
}

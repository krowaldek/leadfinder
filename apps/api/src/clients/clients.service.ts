import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import { ClientMatchingService } from "./client-matching.service.js";
import type { ClientProfileFields, UpdateClient } from "@leadfinder/contracts";
import type { AppEnv } from "../config/env.js";

const SCOPE_LABELS = {
  NATIONAL: "cała Polska",
  REGIONAL: "region/województwo",
  LOCAL: "lokalny",
} as const;

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClientMatchingService)
    private readonly matchingService: ClientMatchingService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {}

  async createFromProfile(
    fields: ClientProfileFields,
  ): Promise<{ client: ReturnType<ClientsService["serializeClient"]>; matchCount: number }> {
    const basicSummary = this.buildProfileSummary(fields);
    const profileSummary = await this.enrichProfileForEmbedding(fields, basicSummary);

    const client = await this.prisma.client.create({
      data: {
        companyName: fields.companyName,
        industry: fields.industry,
        geographicScope: fields.geographicScope,
        geographicDetails: fields.geographicDetails ?? null,
        budgetDescription: fields.budgetDescription,
        contactPersonName: fields.contactPersonName,
        contactPersonRole: fields.contactPersonRole,
        profileSummary,
      },
    });

    this.logger.log(`Created client: ${client.companyName} (${client.id})`);

    let matchCount = 0;
    try {
      matchCount = await this.matchingService.matchClient(client.id);
    } catch (err) {
      this.logger.error(`Initial matching failed for ${client.id}: ${String(err)}`);
    }

    return { client: this.serializeClient(client, matchCount), matchCount };
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { _count: { select: { matches: true } } },
      }),
      this.prisma.client.count(),
    ]);

    return {
      data: rows.map((c) =>
        this.serializeClient(c, c._count.matches),
      ),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { matches: true } } },
    });
    if (!client) throw new NotFoundException("Client not found");
    return this.serializeClient(client, client._count.matches);
  }

  async getMatches(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException("Client not found");

    const matches = await this.prisma.clientMatch.findMany({
      where: { clientId },
      include: {
        announcementItem: {
          include: {
            announcement: {
              select: {
                id: true,
                title: true,
                url: true,
                sourceSystem: true,
                externalId: true,
                publishedAt: true,
                deadlineAt: true,
                valueMin: true,
                valueMax: true,
                detailedReport: true,
              },
            },
          },
        },
      },
      orderBy: { similarity: "desc" },
    });

    return {
      clientProfileSummary: client.profileSummary,
      data: matches.map((m) => ({
        id: m.id,
        clientId: m.clientId,
        announcementItemId: m.announcementItemId,
        similarity: m.similarity,
        status: m.status,
        announcementItem: {
          id: m.announcementItem.id,
          title: m.announcementItem.title,
          description: m.announcementItem.description,
          price: m.announcementItem.price?.toString() ?? null,
          kind: m.announcementItem.kind ?? null,
          shortSummary: m.announcementItem.shortSummary ?? null,
          llmEstimatedValue: m.announcementItem.llmEstimatedValue?.toString() ?? null,
          searchContext: m.announcementItem.searchContext,
          announcement: {
            id: m.announcementItem.announcement.id,
            title: m.announcementItem.announcement.title,
            url: m.announcementItem.announcement.url,
            sourceSystem: m.announcementItem.announcement.sourceSystem,
            externalId: m.announcementItem.announcement.externalId,
            detailedReport: m.announcementItem.announcement.detailedReport ?? null,
            publishedAt:
              m.announcementItem.announcement.publishedAt?.toISOString() ?? null,
            deadlineAt:
              m.announcementItem.announcement.deadlineAt?.toISOString() ?? null,
            valueMin:
              m.announcementItem.announcement.valueMin?.toString() ?? null,
            valueMax:
              m.announcementItem.announcement.valueMax?.toString() ?? null,
          },
        },
        createdAt: m.createdAt.toISOString(),
      })),
      meta: { total: matches.length },
    };
  }

  async updateMatchStatus(clientId: string, matchId: string, status: string) {
    const match = await this.prisma.clientMatch.findFirst({
      where: { id: matchId, clientId },
    });
    if (!match) throw new NotFoundException("Match not found");

    return this.prisma.clientMatch.update({
      where: { id: matchId },
      data: { status: status as never },
    });
  }

  serializeClient(
    client: {
      id: string;
      companyName: string;
      industry: string;
      geographicScope: string;
      geographicDetails: string | null;
      budgetDescription: string;
      contactPersonName: string;
      contactPersonRole: string;
      profileSummary: string;
      negativeKeywords: string[];
      status: string;
      createdAt: Date;
      updatedAt: Date;
    },
    matchCount: number,
  ) {
    return {
      id: client.id,
      companyName: client.companyName,
      industry: client.industry,
      geographicScope: client.geographicScope as "NATIONAL" | "REGIONAL" | "LOCAL",
      geographicDetails: client.geographicDetails,
      budgetDescription: client.budgetDescription,
      contactPersonName: client.contactPersonName,
      contactPersonRole: client.contactPersonRole,
      profileSummary: client.profileSummary,
      negativeKeywords: client.negativeKeywords,
      status: client.status as "ACTIVE" | "INACTIVE",
      matchCount,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    };
  }

  async updateClient(
    id: string,
    data: UpdateClient,
  ): Promise<ReturnType<ClientsService["serializeClient"]>> {
    const existing = await this.prisma.client.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Client not found");

    const merged = {
      companyName: data.companyName ?? existing.companyName,
      industry: data.industry ?? existing.industry,
      geographicScope: (data.geographicScope ?? existing.geographicScope) as "NATIONAL" | "REGIONAL" | "LOCAL",
      geographicDetails:
        data.geographicDetails !== undefined
          ? data.geographicDetails
          : existing.geographicDetails,
      budgetDescription: data.budgetDescription ?? existing.budgetDescription,
      contactPersonName: data.contactPersonName ?? existing.contactPersonName,
      contactPersonRole: data.contactPersonRole ?? existing.contactPersonRole,
      negativeKeywords: data.negativeKeywords ?? existing.negativeKeywords,
    };

    const mergedForProfile = { ...merged, geographicDetails: merged.geographicDetails ?? undefined };
    const basicSummary = this.buildProfileSummary(mergedForProfile);
    const profileSummary = await this.enrichProfileForEmbedding(
      mergedForProfile,
      basicSummary,
    );

    // Nullify the pgvector embedding via raw SQL (Unsupported type, not settable via Prisma client)
    await this.prisma.$executeRaw`
      UPDATE clients SET "profileEmbedding" = NULL WHERE id = ${id}::uuid
    `;

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        companyName: merged.companyName,
        industry: merged.industry,
        geographicScope: merged.geographicScope,
        geographicDetails: merged.geographicDetails ?? null,
        budgetDescription: merged.budgetDescription,
        contactPersonName: merged.contactPersonName,
        contactPersonRole: merged.contactPersonRole,
        negativeKeywords: merged.negativeKeywords,
        profileSummary,
      },
    });

    this.logger.log(`Updated client: ${updated.companyName} (${updated.id})`);

    const matchCount = await this.prisma.clientMatch.count({ where: { clientId: id } });
    return this.serializeClient(updated, matchCount);
  }

  private async enrichProfileForEmbedding(
    fields: ClientProfileFields & { negativeKeywords?: string[] },
    basicSummary: string,
  ): Promise<string> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY") ?? "";
    if (!apiKey || !apiKey.startsWith("sk-") || apiKey.includes("xxx")) {
      this.logger.warn("OPENAI_API_KEY not configured — skipping profile enrichment, using basic summary.");
      return basicSummary;
    }

    const chatModel = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    const llm = new ChatOpenAI({ apiKey, model: chatModel, temperature: 0.3 });

    const scope = SCOPE_LABELS[fields.geographicScope];
    const geo = fields.geographicDetails
      ? `${scope} (${fields.geographicDetails})`
      : scope;

    const negSection =
      fields.negativeKeywords && fields.negativeKeywords.length > 0
        ? `\n\nFirma NIE jest zainteresowana następującymi zakresami i je wyklucza (pomiń je w profilu): ${fields.negativeKeywords.join(", ")}`
        : "";

    const prompt = `Jesteś ekspertem od zamówień publicznych i przetargów w Polsce (BZP, Baza Konkurencyjności, e-Zamówienia, platformy zakupowe).

Na podstawie poniższego profilu firmy wygeneruj BOGATY PROFIL TECHNICZNY przeznaczony do przeszukiwania wektorowego ogłoszeń przetargowych.

== PROFIL FIRMY ==
Firma: ${fields.companyName}
Branża/Specjalizacja: ${fields.industry}
Zasięg geograficzny: ${geo}
Skala zamówień: ${fields.budgetDescription}${negSection}

== TWOJE ZADANIE ==
Wygeneruj zwięzły tekst (max 350 słów) bogaty w:
1. Specjalistyczne słownictwo branżowe używane w ogłoszeniach przetargowych
2. Synonimy i alternatywne nazewnictwo tej samej działalności w języku zamówień publicznych
3. Powiązane zakresy prac, dostaw lub usług, które firma z tej branży typowo realizuje
4. Słowne odpowiedniki kodów CPV i terminologię z SIWZ/SWZ/OPZ
5. Wyrazy kluczowe często pojawiające się w tytułach i opisach ogłoszeń dla tej branży

WAŻNE:
- Tekst ma być GĘSTY w słowa kluczowe — jest wejściem dla modelu embeddingowego, nie dla człowieka
- Pisz po polsku, pełnymi zdaniami lub listami fraz
- NIE włączaj wykluczeń do profilu — pisz wyłącznie to, czego firma SZUKA
- NIE powtarzaj danych kontaktowych, budżetu ani zasięgu — skup się wyłącznie na terminologii branżowej
- NIE dodawaj nagłówków, wstępów ani komentarzy — tylko sam tekst profilu`;

    try {
      const response = await llm.invoke([new HumanMessage(prompt)]);
      const enriched = (response.content as string).trim();
      if (enriched.length > 80) {
        this.logger.log(`Profile enriched with technical synonyms for: ${fields.companyName}`);
        return `${basicSummary}\n\n${enriched}`;
      }
    } catch (err) {
      this.logger.warn(`Profile enrichment failed — using basic summary: ${String(err)}`);
    }

    return basicSummary;
  }

  private buildProfileSummary(fields: ClientProfileFields & { negativeKeywords?: string[] }): string {
    const scopeLabel = SCOPE_LABELS[fields.geographicScope];
    const geo = fields.geographicDetails
      ? `${scopeLabel} (${fields.geographicDetails})`
      : scopeLabel;

    const parts = [
      `FIRMA: ${fields.companyName}`,
      `BRANŻA: ${fields.industry}`,
      `ZASIĘG: ${geo}`,
      `BUDŻET: ${fields.budgetDescription}`,
      `KONTAKT: ${fields.contactPersonName} — ${fields.contactPersonRole}`,
    ];

    if (fields.negativeKeywords && fields.negativeKeywords.length > 0) {
      parts.push(`WYKLUCZENIA: ${fields.negativeKeywords.join(", ")}`);
    }

    return parts.join(" | ");
  }
}

import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../database/prisma.service.js";
import type { ClientProfileFields, UpdateClient } from "@leadfinder/contracts";
import { CLIENT_MATCHING_QUEUE, ClientMatchingJob } from "./client-matching.constants.js";

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
    @InjectQueue(CLIENT_MATCHING_QUEUE)
    private readonly matchingQueue: Queue,
  ) {}

  async createFromProfile(
    fields: ClientProfileFields,
  ): Promise<{ client: ReturnType<ClientsService["serializeClient"]>; matchCount: number }> {
    const basicSummary = this.buildProfileSummary(fields);

    const client = await this.prisma.client.create({
      data: {
        companyName: fields.companyName,
        industry: fields.industry,
        geographicScope: fields.geographicScope,
        geographicDetails: fields.geographicDetails ?? null,
        budgetDescription: fields.budgetDescription,
        contactPersonName: fields.contactPersonName,
        contactPersonRole: fields.contactPersonRole,
        profileSummary: basicSummary,
      },
    });

    this.logger.log(`Created client: ${client.companyName} (${client.id})`);

    await this.enqueueMatching(client.id);

    return { client: this.serializeClient(client, 0), matchCount: 0 };
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
      clientEmbeddingText: client.syntheticAnnouncementText ?? client.profileSummary,
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
          detailedReport: m.announcementItem.detailedReport ?? null,
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

    // Nullify matching representation so background job regenerates synthetic announcement + embedding
    await this.prisma.$executeRaw`
      UPDATE clients
      SET "profileEmbedding" = NULL,
          "syntheticAnnouncementText" = NULL,
          "updatedAt" = NOW()
      WHERE id = ${id}::uuid
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
        profileSummary: basicSummary,
      },
    });

    this.logger.log(`Updated client: ${updated.companyName} (${updated.id})`);

    await this.enqueueMatching(updated.id);

    const matchCount = await this.prisma.clientMatch.count({ where: { clientId: id } });
    return this.serializeClient(updated, matchCount);
  }

  async enqueueMatching(clientId: string): Promise<void> {
    await this.matchingQueue.add(
      ClientMatchingJob.MATCH_CLIENT,
      { clientId },
      {
        jobId: `client-match-${clientId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 10 },
      },
    );
  }

  async backfillClients(options?: { status?: "ACTIVE" | "INACTIVE" }): Promise<{
    queued: number;
    total: number;
    status: "ACTIVE" | "INACTIVE" | "ALL";
  }> {
    const filterStatus = options?.status;
    const clients = await this.prisma.client.findMany({
      where: filterStatus ? { status: filterStatus } : undefined,
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    if (clients.length === 0) {
      return { queued: 0, total: 0, status: filterStatus ?? "ALL" };
    }

    for (const client of clients) {
      await this.prisma.$executeRaw`
        UPDATE clients
        SET "profileEmbedding" = NULL,
            "syntheticAnnouncementText" = NULL,
            "updatedAt" = NOW()
        WHERE id = ${client.id}::uuid
      `;
      await this.enqueueMatching(client.id);
    }

    this.logger.log(
      `Backfill queued for ${clients.length} client(s) with status=${filterStatus ?? "ALL"}`,
    );

    return {
      queued: clients.length,
      total: clients.length,
      status: filterStatus ?? "ALL",
    };
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

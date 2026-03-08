import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { ClientMatchingService } from "./client-matching.service.js";
import type { ClientProfileFields } from "@leadfinder/contracts";

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
  ) {}

  async createFromProfile(
    fields: ClientProfileFields,
  ): Promise<{ client: ReturnType<ClientsService["serializeClient"]>; matchCount: number }> {
    const profileSummary = this.buildProfileSummary(fields);

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
                valueMin: true,
                valueMax: true,
              },
            },
          },
        },
      },
      orderBy: { similarity: "desc" },
    });

    return {
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
          announcement: {
            id: m.announcementItem.announcement.id,
            title: m.announcementItem.announcement.title,
            url: m.announcementItem.announcement.url,
            sourceSystem: m.announcementItem.announcement.sourceSystem,
            externalId: m.announcementItem.announcement.externalId,
            publishedAt:
              m.announcementItem.announcement.publishedAt?.toISOString() ?? null,
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
      status: client.status as "ACTIVE" | "INACTIVE",
      matchCount,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    };
  }

  private buildProfileSummary(fields: ClientProfileFields): string {
    const scopeLabel = SCOPE_LABELS[fields.geographicScope];
    const geo = fields.geographicDetails
      ? `${scopeLabel} (${fields.geographicDetails})`
      : scopeLabel;

    return [
      `FIRMA: ${fields.companyName}`,
      `BRANŻA: ${fields.industry}`,
      `ZASIĘG: ${geo}`,
      `BUDŻET: ${fields.budgetDescription}`,
      `KONTAKT: ${fields.contactPersonName} — ${fields.contactPersonRole}`,
    ].join(" | ");
  }
}

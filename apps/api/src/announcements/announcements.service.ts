import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AnnouncementsListQuery } from "@leadfinder/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async findAll(query: AnnouncementsListQuery) {
    const search = (query.search ?? "").trim();
    const offset = (query.page - 1) * query.limit;

    // Build WHERE conditions — rawData::text ILIKE covers project names stored only in raw JSON
    const conditions: Prisma.Sql[] = [];

    if (search) {
      const like = `%${search}%`;
      conditions.push(Prisma.sql`(
        title ILIKE ${like}
        OR description ILIKE ${like}
        OR "searchContext" ILIKE ${like}
        OR "rawData"::text ILIKE ${like}
      )`);
    }
    if (query.source) {
      conditions.push(Prisma.sql`"sourceSystem" = ${query.source}::"AnnouncementSource"`);
    }
    if (query.status) {
      conditions.push(Prisma.sql`status = ${query.status}::"AnnouncementStatus"`);
    }

    const where = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.sql``;

    type Row = {
      id: string; sourceSystem: string; externalId: string; partIndex: number;
      title: string; description: string | null; url: string; status: string;
      kind: string | null; embeddingStatus: string;
      valueMin: string | null; valueMax: string | null; llmEstimatedValue: string | null;
      publishedAt: Date | null; deadlineAt: Date | null;
      createdAt: Date; updatedAt: Date;
    };

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT
          id, "sourceSystem", "externalId", "partIndex",
          title, description, url, status, kind, "embeddingStatus",
          "valueMin"::text AS "valueMin",
          "valueMax"::text AS "valueMax",
          "llmEstimatedValue"::text AS "llmEstimatedValue",
          "publishedAt", "deadlineAt", "createdAt", "updatedAt"
        FROM announcements
        ${where}
        ORDER BY "createdAt" DESC
        LIMIT ${query.limit} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<[{ count: bigint }]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM announcements ${where}`
      ),
    ]);

    const total = Number(countRows[0].count);

    return {
      data: rows,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(id: string) {
    const a = await this.prisma.announcement.findUnique({
      where: { id },
      select: {
        id: true,
        sourceSystem: true,
        externalId: true,
        partIndex: true,
        title: true,
        description: true,
        searchContext: true,
        url: true,
        status: true,
        kind: true,
        embeddingStatus: true,
        valueMin: true,
        valueMax: true,
        llmEstimatedValue: true,
        detailedReport: true,
        publishedAt: true,
        deadlineAt: true,
        rawData: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!a) throw new NotFoundException("Announcement not found");

    return {
      ...a,
      valueMin: a.valueMin != null ? a.valueMin.toString() : null,
      valueMax: a.valueMax != null ? a.valueMax.toString() : null,
      llmEstimatedValue: a.llmEstimatedValue != null ? a.llmEstimatedValue.toString() : null,
    };
  }
}

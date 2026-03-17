import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AnnouncementsListQuery, AuthUser } from "@leadfinder/contracts";
import { PrismaService } from "../database/prisma.service.js";

type InternalChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type InternalChatComment = {
  id: string;
  content: string;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
};

type InternalPromptRawData = {
  type?: string;
  createdVia?: string;
  collected?: Record<string, unknown>;
  conversation?: InternalChatMessage[];
  feedbackComments?: InternalChatComment[];
};

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
        OR "externalId" ILIKE ${like}
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
      title: string; aiTitle: string | null; displayTitle: string; description: string | null; url: string; status: string;
      kind: string | null; embeddingStatus: string;
      location: string | null; contractingAuthority: string | null;
      valueMin: string | null; valueMax: string | null; llmEstimatedValue: string | null;
      publishedAt: Date | null; deadlineAt: Date | null;
      createdAt: Date; updatedAt: Date;
    };

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT
          id, "sourceSystem", "externalId", "partIndex",
          title, "aiTitle", COALESCE("aiTitle", title) AS "displayTitle", description, url, status, kind, "embeddingStatus",
          location, "contractingAuthority",
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
    type AnnouncementRow = {
      id: string;
      sourceSystem: string;
      externalId: string;
      partIndex: number;
      title: string;
      aiTitle: string | null;
      displayTitle: string;
      description: string | null;
      searchContext: string;
      url: string;
      status: string;
      kind: string | null;
      embeddingStatus: string;
      valueMin: string | null;
      valueMax: string | null;
      llmEstimatedValue: string | null;
      detailedReport: string | null;
      publishedAt: Date | null;
      deadlineAt: Date | null;
      location: string | null;
      contractingAuthority: string | null;
      rawData: unknown;
      createdAt: Date;
      updatedAt: Date;
    };

    const rows = await this.prisma.$queryRaw<AnnouncementRow[]>(Prisma.sql`
      SELECT
        id,
        "sourceSystem",
        "externalId",
        "partIndex",
        title,
        "aiTitle",
        COALESCE("aiTitle", title) AS "displayTitle",
        description,
        "searchContext",
        url,
        status,
        kind,
        "embeddingStatus",
        "valueMin"::text AS "valueMin",
        "valueMax"::text AS "valueMax",
        "llmEstimatedValue"::text AS "llmEstimatedValue",
        "detailedReport",
        "publishedAt",
        "deadlineAt",
        location,
        "contractingAuthority",
        "rawData",
        "createdAt",
        "updatedAt"
      FROM announcements
      WHERE id = ${id}::uuid
      LIMIT 1
    `);

    const a = rows[0] ?? null;

    if (!a) throw new NotFoundException("Announcement not found");

    return a;
  }

  async findInternalPromptChats(query: { page: number; limit: number; search?: string }) {
    const search = (query.search ?? "").trim();
    const offset = (query.page - 1) * query.limit;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"sourceSystem" = 'INTERNAL'::"AnnouncementSource"`,
      Prisma.sql`"rawData"->>'createdVia' = 'prompt'`,
    ];

    if (search) {
      const like = `%${search}%`;
      conditions.push(Prisma.sql`(
        title ILIKE ${like}
        OR description ILIKE ${like}
        OR "rawData"::text ILIKE ${like}
      )`);
    }

    const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

    type ChatRow = {
      id: string;
      title: string;
      description: string | null;
      rawData: unknown;
      createdAt: Date;
      updatedAt: Date;
    };

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<ChatRow[]>(Prisma.sql`
        SELECT id, title, description, "rawData", "createdAt", "updatedAt"
        FROM announcements
        ${where}
        ORDER BY "updatedAt" DESC, "createdAt" DESC
        LIMIT ${query.limit} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<[{ count: bigint }]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM announcements ${where}`
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0n);

    return {
      data: rows.map((row) => {
        const rawData = this.readInternalPromptRawData(row.rawData);
        const messages = rawData.conversation ?? [];
        const comments = rawData.feedbackComments ?? [];
        const lastMessagePreview = messages.length > 0
          ? this.buildPreview(messages[messages.length - 1]?.content ?? null)
          : null;

        return {
          id: row.id,
          title: row.title,
          description: row.description,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          messageCount: messages.length,
          commentCount: comments.length,
          lastMessagePreview,
        };
      }),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async findInternalPromptChat(id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        id,
        sourceSystem: "INTERNAL",
      },
      select: {
        id: true,
        title: true,
        description: true,
        detailedReport: true,
        rawData: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!announcement) throw new NotFoundException("Chat history not found");

    const rawData = this.readInternalPromptRawData(announcement.rawData);
    if (rawData.createdVia !== "prompt") throw new NotFoundException("Chat history not found");

    return {
      id: announcement.id,
      title: announcement.title,
      description: announcement.description,
      detailedReport: announcement.detailedReport,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt,
      collectedData: rawData.collected ?? {},
      conversation: rawData.conversation ?? [],
      feedbackComments: rawData.feedbackComments ?? [],
    };
  }

  async addInternalPromptChatComment(id: string, content: string, user: AuthUser) {
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        id,
        sourceSystem: "INTERNAL",
      },
      select: {
        rawData: true,
      },
    });

    if (!announcement) throw new NotFoundException("Chat history not found");

    const rawData = this.readInternalPromptRawData(announcement.rawData);
    if (rawData.createdVia !== "prompt") throw new NotFoundException("Chat history not found");

    const nextComments = [
      ...(rawData.feedbackComments ?? []),
      {
        id: crypto.randomUUID(),
        content: content.trim(),
        createdAt: new Date().toISOString(),
        authorName: user.fullName,
        authorEmail: user.email,
      },
    ];

    const nextRawData = {
      ...rawData,
      feedbackComments: nextComments,
    } as Prisma.InputJsonValue;

    await this.prisma.announcement.update({
      where: { id },
      data: { rawData: nextRawData },
    });

    return this.findInternalPromptChat(id);
  }

  private readInternalPromptRawData(rawData: unknown): InternalPromptRawData {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      return {};
    }

    const payload = rawData as Record<string, unknown>;
    const conversation = Array.isArray(payload.conversation)
      ? payload.conversation.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          const role = item.role;
          const content = item.content;
          if ((role === "user" || role === "assistant") && typeof content === "string") {
            return [{ role, content } satisfies InternalChatMessage];
          }
          return [];
        })
      : [];
    const feedbackComments = Array.isArray(payload.feedbackComments)
      ? payload.feedbackComments.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          if (typeof item.id !== "string" || typeof item.content !== "string" || typeof item.createdAt !== "string") {
            return [];
          }
          return [{
            id: item.id,
            content: item.content,
            createdAt: item.createdAt,
            authorName: typeof item.authorName === "string" ? item.authorName : null,
            authorEmail: typeof item.authorEmail === "string" ? item.authorEmail : null,
          } satisfies InternalChatComment];
        })
      : [];

    return {
      type: typeof payload.type === "string" ? payload.type : undefined,
      createdVia: typeof payload.createdVia === "string" ? payload.createdVia : undefined,
      collected: payload.collected && typeof payload.collected === "object" && !Array.isArray(payload.collected)
        ? payload.collected as Record<string, unknown>
        : {},
      conversation,
      feedbackComments,
    };
  }

  private buildPreview(content: string | null) {
    const normalized = content?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized) return null;
    return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
  }
}

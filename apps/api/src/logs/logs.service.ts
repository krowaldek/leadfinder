import { Injectable, Inject } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { JobLogStatus, JobLogType } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../database/prisma.service.js";
import { EMBEDDING_QUEUE } from "../embedding/embedding-queue.constants.js";

export interface LogsQuery {
  page?: number;
  limit?: number;
  status?: JobLogStatus;
}

export interface LogsResult {
  data: LogEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface LogEntry {
  id: string;
  type: JobLogType;
  jobId: string | null;
  jobName: string;
  status: JobLogStatus;
  entityId: string | null;
  entityTitle: string | null;
  payload: unknown;
  result: unknown;
  error: string | null;
  durationMs: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface LogsStats {
  scraper: TypeStats;
  embedding: TypeStats;
  report: TypeStats;
}

export interface TypeStats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  lastRunAt: Date | null;
  avgDurationMs: number | null;
}

export interface ReembedSourceProgress {
  sourceSystem: string;
  totalItems: number;
  embeddedItems: number;
  itemsWithReport: number;
  reportReadyItems: number;
  embeddedWithReport: number;
  legacyEmbeddedItems: number;
  pendingItems: number;
  errorItems: number;
  reembedCoverage: number;
}

export interface ReembedProgress {
  summary: Omit<ReembedSourceProgress, "sourceSystem">;
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  bySource: ReembedSourceProgress[];
}

@Injectable()
export class LogsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue,
  ) {}

  async findByType(type: JobLogType, query: LogsQuery): Promise<LogsResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where = {
      type,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.jobLog.count({ where }),
      this.prisma.jobLog.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getStats(): Promise<LogsStats> {
    const types: JobLogType[] = ["SCRAPER", "EMBEDDING", "REPORT"];

    const results = await Promise.all(
      types.map(async (type) => {
        const rows = await this.prisma.jobLog.groupBy({
          by: ["status"],
          where: { type },
          _count: { status: true },
        });

        const countMap: Record<string, number> = {};
        for (const row of rows) {
          countMap[row.status] = row._count.status;
        }

        const lastLog = await this.prisma.jobLog.findFirst({
          where: { type, status: { in: ["COMPLETED", "FAILED"] } },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });

        const avgResult = await this.prisma.jobLog.aggregate({
          where: { type, status: "COMPLETED", durationMs: { not: null } },
          _avg: { durationMs: true },
        });

        return {
          type,
          stats: {
            total: Object.values(countMap).reduce((a, b) => a + b, 0),
            completed: countMap["COMPLETED"] ?? 0,
            failed: countMap["FAILED"] ?? 0,
            running: countMap["STARTED"] ?? 0,
            lastRunAt: lastLog?.startedAt ?? null,
            avgDurationMs: avgResult._avg.durationMs ?? null,
          } satisfies TypeStats,
        };
      }),
    );

    return {
      scraper: results.find((r) => r.type === "SCRAPER")!.stats,
      embedding: results.find((r) => r.type === "EMBEDDING")!.stats,
      report: results.find((r) => r.type === "REPORT")!.stats,
    };
  }

  async getReembedProgress(): Promise<ReembedProgress> {
    const [rows, queue] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<Omit<ReembedSourceProgress, "reembedCoverage">>>(`
        SELECT
          a."sourceSystem" AS "sourceSystem",
          COUNT(*)::int AS "totalItems",
          COUNT(*) FILTER (WHERE ai.status = 'EMBEDDED'::"AnnouncementItemStatus")::int AS "embeddedItems",
          COUNT(*) FILTER (WHERE ai."detailedReport" IS NOT NULL)::int AS "itemsWithReport",
          COUNT(*) FILTER (
            WHERE ai.kind IS NOT NULL
              AND ai."shortSummary" IS NOT NULL
              AND ai."detailedReport" IS NOT NULL
          )::int AS "reportReadyItems",
          COUNT(*) FILTER (
            WHERE ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
              AND ai."detailedReport" IS NOT NULL
          )::int AS "embeddedWithReport",
          COUNT(*) FILTER (
            WHERE ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
              AND ai."detailedReport" IS NULL
          )::int AS "legacyEmbeddedItems",
          COUNT(*) FILTER (WHERE ai.status = 'PENDING'::"AnnouncementItemStatus")::int AS "pendingItems",
          COUNT(*) FILTER (WHERE ai.status = 'ERROR'::"AnnouncementItemStatus")::int AS "errorItems"
        FROM announcement_items ai
        JOIN announcements a ON a.id = ai."announcementId"
        GROUP BY a."sourceSystem"
        ORDER BY a."sourceSystem" ASC
      `),
      this.embeddingQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    ]);

    const bySource = rows.map((row) => ({
      ...row,
      reembedCoverage:
        row.embeddedItems > 0
          ? Number((row.embeddedWithReport / row.embeddedItems).toFixed(4))
          : 0,
    }));

    const summary = bySource.reduce<Omit<ReembedSourceProgress, "sourceSystem">>(
      (acc, row) => ({
        totalItems: acc.totalItems + row.totalItems,
        embeddedItems: acc.embeddedItems + row.embeddedItems,
        itemsWithReport: acc.itemsWithReport + row.itemsWithReport,
        reportReadyItems: acc.reportReadyItems + row.reportReadyItems,
        embeddedWithReport: acc.embeddedWithReport + row.embeddedWithReport,
        legacyEmbeddedItems: acc.legacyEmbeddedItems + row.legacyEmbeddedItems,
        pendingItems: acc.pendingItems + row.pendingItems,
        errorItems: acc.errorItems + row.errorItems,
        reembedCoverage: 0,
      }),
      {
        totalItems: 0,
        embeddedItems: 0,
        itemsWithReport: 0,
        reportReadyItems: 0,
        embeddedWithReport: 0,
        legacyEmbeddedItems: 0,
        pendingItems: 0,
        errorItems: 0,
        reembedCoverage: 0,
      },
    );

    summary.reembedCoverage =
      summary.embeddedItems > 0
        ? Number((summary.embeddedWithReport / summary.embeddedItems).toFixed(4))
        : 0;

    return {
      summary,
      queue: {
        waiting: queue.waiting,
        active: queue.active,
        completed: queue.completed,
        failed: queue.failed,
        delayed: queue.delayed,
      },
      bySource,
    };
  }
}

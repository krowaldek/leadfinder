import { Injectable, Inject } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { JobLogStatus, JobLogType } from "@prisma/client";
import { Job, Queue } from "bullmq";
import { PrismaService } from "../database/prisma.service.js";
import { CLIENT_MATCHING_QUEUE } from "../clients/client-matching.constants.js";
import { EMBEDDING_QUEUE } from "../embedding/embedding-queue.constants.js";
import { SCRAPER_QUEUE } from "../scrapers/scraper-queue.constants.js";

type SupportedJobLogType = "SCRAPER" | "EMBEDDING" | "MATCHING" | "REPORT";

export interface LogsQuery {
  page?: number;
  limit?: number;
  status?: JobLogStatus;
  jobName?: string;
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
  matching: TypeStats;
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

export interface TokenTypeStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  jobsWithTokens: number;
}

export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  jobsWithTokens: number;
  byType: Record<string, TokenTypeStats>;
}

export interface QueueJobPreview {
  id: string;
  name: string;
  state: "waiting" | "active" | "delayed";
  attemptsMade: number;
  createdAt: number;
  delay: number;
  data: Record<string, unknown> | null;
}

export interface QueueDetails {
  key: string;
  label: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  pending: QueueJobPreview[];
}

export interface QueuesOverview {
  generatedAt: string;
  queues: QueueDetails[];
}

@Injectable()
export class LogsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue,
    @InjectQueue(SCRAPER_QUEUE)
    private readonly scraperQueue: Queue,
    @InjectQueue(CLIENT_MATCHING_QUEUE)
    private readonly matchingQueue: Queue,
  ) {}

  private summarizeJobData(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(data)
        .slice(0, 8)
        .map(([key, value]) => {
          if (typeof value === "string" && value.length > 120) {
            return [key, `${value.slice(0, 117)}...`];
          }

          return [key, value];
        }),
    );
  }

  private mapJobs(
    state: "waiting" | "active" | "delayed",
    jobs: Job[],
  ): QueueJobPreview[] {
    return jobs.map((job) => ({
      id: String(job.id),
      name: job.name,
      state,
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp,
      delay: job.delay,
      data: this.summarizeJobData(job.data),
    }));
  }

  private async getQueueDetails(
    queue: Queue,
    key: string,
    label: string,
  ): Promise<QueueDetails> {
    const [counts, waiting, active, delayed] = await Promise.all([
      queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      queue.getWaiting(0, 9),
      queue.getActive(0, 4),
      queue.getDelayed(0, 4),
    ]);

    return {
      key,
      label,
      counts: {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
      },
      pending: [
        ...this.mapJobs("waiting", waiting),
        ...this.mapJobs("active", active),
        ...this.mapJobs("delayed", delayed),
      ],
    };
  }

  async findByType(type: SupportedJobLogType, query: LogsQuery): Promise<LogsResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where = {
      type: type as JobLogType,
      ...(query.status ? { status: query.status } : {}),
      ...(query.jobName ? { jobName: query.jobName } : {}),
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
    const types: SupportedJobLogType[] = ["SCRAPER", "EMBEDDING", "MATCHING", "REPORT"];

    const results = await Promise.all(
      types.map(async (type) => {
        const rows = await this.prisma.jobLog.groupBy({
          by: ["status"],
          where: { type: type as JobLogType },
          _count: { status: true },
        });

        const countMap: Record<string, number> = {};
        for (const row of rows) {
          countMap[row.status] = row._count.status;
        }

        const lastLog = await this.prisma.jobLog.findFirst({
          where: { type: type as JobLogType, status: { in: ["COMPLETED", "FAILED"] } },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });

        const avgResult = await this.prisma.jobLog.aggregate({
          where: { type: type as JobLogType, status: "COMPLETED", durationMs: { not: null } },
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

    const statsMap = Object.fromEntries(
      results.map((entry) => [entry.type, entry.stats]),
    ) as Record<SupportedJobLogType, TypeStats>;

    return {
      scraper: statsMap.SCRAPER,
      embedding: statsMap.EMBEDDING,
      matching: statsMap.MATCHING,
      report: statsMap.REPORT,
    };
  }

  async getReembedProgress(): Promise<ReembedProgress> {
    const [rows, queue] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<Omit<ReembedSourceProgress, "reembedCoverage">>>(`
        SELECT
          a."sourceSystem" AS "sourceSystem",
          COUNT(*)::int AS "totalItems",
          COUNT(*) FILTER (WHERE a."embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus")::int AS "embeddedItems",
          COUNT(*) FILTER (WHERE a."detailedReport" IS NOT NULL)::int AS "itemsWithReport",
          COUNT(*) FILTER (
            WHERE a.kind IS NOT NULL
              AND a."detailedReport" IS NOT NULL
          )::int AS "reportReadyItems",
          COUNT(*) FILTER (
            WHERE a."embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus"
              AND a."detailedReport" IS NOT NULL
          )::int AS "embeddedWithReport",
          COUNT(*) FILTER (
            WHERE a."embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus"
              AND a."detailedReport" IS NULL
          )::int AS "legacyEmbeddedItems",
          COUNT(*) FILTER (WHERE a."embeddingStatus" = 'PENDING'::"EmbeddingStatus")::int AS "pendingItems",
          COUNT(*) FILTER (WHERE a."embeddingStatus" = 'ERROR'::"EmbeddingStatus")::int AS "errorItems"
        FROM announcements a
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

  async getTokenStats(): Promise<TokenStats> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        job_type: string;
        prompt_tokens: bigint;
        completion_tokens: bigint;
        total_tokens: bigint;
        jobs_count: bigint;
      }>
    >`
      SELECT
        type                                                            AS job_type,
        COALESCE(SUM((result->>'promptTokens')::bigint), 0)            AS prompt_tokens,
        COALESCE(SUM((result->>'completionTokens')::bigint), 0)        AS completion_tokens,
        COALESCE(SUM((result->>'totalTokens')::bigint), 0)             AS total_tokens,
        COUNT(*) FILTER (WHERE result->>'totalTokens' IS NOT NULL)     AS jobs_count
      FROM job_logs
      WHERE status = 'COMPLETED'
        AND result IS NOT NULL
      GROUP BY type
    `;

    const byType: Record<string, TokenTypeStats> = {};
    let sumPrompt = 0;
    let sumCompletion = 0;
    let sumTotal = 0;
    let sumJobs = 0;

    for (const row of rows) {
      const p = Number(row.prompt_tokens);
      const c = Number(row.completion_tokens);
      const t = Number(row.total_tokens);
      const j = Number(row.jobs_count);
      byType[row.job_type] = { promptTokens: p, completionTokens: c, totalTokens: t, jobsWithTokens: j };
      sumPrompt += p;
      sumCompletion += c;
      sumTotal += t;
      sumJobs += j;
    }

    return {
      promptTokens: sumPrompt,
      completionTokens: sumCompletion,
      totalTokens: sumTotal,
      jobsWithTokens: sumJobs,
      byType,
    };
  }

  async getQueuesOverview(): Promise<QueuesOverview> {
    const queues = await Promise.all([
      this.getQueueDetails(this.scraperQueue, "scraper", "Scraper"),
      this.getQueueDetails(this.embeddingQueue, "embedding", "Embedding"),
      this.getQueueDetails(this.matchingQueue, "client-matching", "Client matching"),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      queues,
    };
  }
}

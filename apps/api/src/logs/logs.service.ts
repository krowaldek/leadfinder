import { Injectable, Inject } from "@nestjs/common";
import type { JobLogStatus, JobLogType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";

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

@Injectable()
export class LogsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
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
}

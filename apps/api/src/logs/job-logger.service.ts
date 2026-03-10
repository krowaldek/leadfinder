import { Injectable, Inject, Logger } from "@nestjs/common";
import type { JobLogType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";

export interface StartLogOptions {
  type: JobLogType;
  jobId?: string;
  jobName: string;
  entityId?: string;
  entityTitle?: string;
  payload?: Record<string, unknown>;
}

export interface FinishLogOptions {
  logId: string;
  status: "COMPLETED" | "FAILED";
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Injectable service for writing structured job-level log entries to the DB.
 * Used by ScraperProcessor, EmbeddingProcessor and AnnouncementReportService.
 */
@Injectable()
export class JobLoggerService {
  private readonly logger = new Logger(JobLoggerService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async start(options: StartLogOptions): Promise<string> {
    try {
      const log = await this.prisma.jobLog.create({
        data: {
          type: options.type,
          jobId: options.jobId ?? null,
          jobName: options.jobName,
          status: "STARTED",
          entityId: options.entityId ?? null,
          entityTitle: options.entityTitle ?? null,
          payload: (options.payload as object) ?? undefined,
          startedAt: new Date(),
        },
        select: { id: true },
      });
      return log.id;
    } catch (err) {
      this.logger.error(`Failed to create job log: ${err}`);
      return "noop";
    }
  }

  async finish(options: FinishLogOptions): Promise<void> {
    if (options.logId === "noop") return;

    try {
      const now = new Date();
      const existing = await this.prisma.jobLog.findUnique({
        where: { id: options.logId },
        select: { startedAt: true },
      });
      const durationMs = existing
        ? now.getTime() - existing.startedAt.getTime()
        : null;

      await this.prisma.jobLog.update({
        where: { id: options.logId },
        data: {
          status: options.status,
          result: (options.result as object) ?? undefined,
          error: options.error ?? null,
          durationMs,
          finishedAt: now,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to update job log ${options.logId}: ${err}`);
    }
  }
}

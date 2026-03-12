import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue, Job } from "bullmq";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { RolesGuard } from "../common/roles.guard.js";
import { Roles } from "../common/roles.decorator.js";
import { SystemRole } from "@prisma/client";
import { SCRAPER_QUEUE, ScraperJob } from "./scraper-queue.constants.js";
import { ScraperScheduleService } from "./scraper-queue.module.js";
import { EmbeddingService } from "../embedding/embedding.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

const updateScheduleSchema = z.object({
  cron: z
    .string()
    .regex(
      /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/,
      "Invalid cron expression",
    ),
});
type UpdateScheduleDto = z.infer<typeof updateScheduleSchema>;

@Controller("scrapers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.ADMIN, SystemRole.SUPER_ADMIN)
export class ScraperController {
  constructor(
    @InjectQueue(SCRAPER_QUEUE)
    private readonly queue: Queue,
    @Inject(ScraperScheduleService)
    private readonly scheduleService: ScraperScheduleService,
    @Inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  /** Manually trigger a BK scraper run */
  @Post("bk/trigger")
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerBk() {
    const job = await this.queue.add(
      ScraperJob.BK_SYNC,
      {},
      {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    );

    return { jobId: job.id, status: "queued" };
  }

  /** Get queue status: counts + last 5 completed / failed jobs */
  @Get("bk/queue-status")

  async queueStatus() {
    const [waiting, active, completed, failed, delayed, repeatableJobs] =
      await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
        this.queue.getRepeatableJobs(),
      ]);

    const recentCompleted = await this.queue.getCompleted(0, 4);
    const recentFailed = await this.queue.getFailed(0, 4);

    return {
      counts: { waiting, active, completed, failed, delayed },
      schedule: repeatableJobs.map((r) => ({
        name: r.name,
        cron: r.pattern,
        next: r.next,
      })),
      recentCompleted: recentCompleted.map(formatJob),
      recentFailed: recentFailed.map(formatJob),
    };
  }

  /** Get single job status by ID */
  @Get("jobs/:jobId")
  async jobStatus(@Param("jobId") jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) return { error: "Job not found" };
    const state = await job.getState();
    return { ...formatJob(job), state };
  }

  /** Update BK scraper cron schedule (takes effect immediately) */
  @Post("bk/schedule")
  @HttpCode(HttpStatus.OK)
  async updateSchedule(
    @Body(new ZodValidationPipe(updateScheduleSchema)) body: UpdateScheduleDto,
  ) {
    const cron = await this.scheduleService.registerSchedules(body.cron);
    return { cron, status: "scheduled" };
  }

  /**
   * Backfill: kolejkuje embedding dla wszystkich ogłoszeń bez embeddingu.
   */
  @Post("embedding/backfill-kind")
  @HttpCode(HttpStatus.ACCEPTED)
  async backfillKind() {
    const queued = await this.embeddingService.backfillAnnouncements();
    return { queued, status: "queued" };
  }

  /**
   * Backfill: uzupełnij deadlineAt dla ogłoszeń BK z brakującym terminem.
   * Czyta submission_deadline z pola rawData (JSON) przechowywanego w DB.
   */
  @Post("bk/backfill-deadlines")
  @HttpCode(HttpStatus.OK)
  async backfillDeadlines() {
    const result = await this.prisma.$executeRaw`
      UPDATE announcements
      SET "deadlineAt" = ("rawData"->>'submission_deadline')::timestamptz
      WHERE "deadlineAt" IS NULL
        AND "rawData"->>'submission_deadline' IS NOT NULL
        AND "sourceSystem" = 'BAZA_KONKURENCYJNOSCI'
    `;
    return { updated: result };
  }
}

function formatJob(job: Job) {
  return {
    id: job.id,
    name: job.name,
    addedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    failedReason: job.failedReason ?? null,
  };
}

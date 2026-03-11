import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EmbeddingService } from "./embedding.service.js";
import { AttachmentEnrichmentService } from "./attachment-enrichment.service.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";
import { JobLoggerService } from "../logs/job-logger.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { AnnouncementReportService } from "../announcements/announcement-report.service.js";

interface EmbedItemPayload {
  itemId: string;
}

interface AnnouncementReportPayload {
  announcementId: string;
}

const EMBEDDING_WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.EMBEDDING_WORKER_CONCURRENCY ?? "6", 10) || 6,
);

@Processor(EMBEDDING_QUEUE, { concurrency: EMBEDDING_WORKER_CONCURRENCY })
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    @Inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @Inject(AttachmentEnrichmentService)
    private readonly enrichmentService: AttachmentEnrichmentService,
    @Inject(AnnouncementReportService)
    private readonly announcementReportService: AnnouncementReportService,
    @Inject(JobLoggerService)
    private readonly jobLogger: JobLoggerService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { itemId, announcementId } = job.data as EmbedItemPayload & AnnouncementReportPayload;

    if (job.name === EmbeddingJob.REPORT_ITEM) {
      this.logger.debug(`Processing REPORT_ITEM for item ${itemId}`);

      const itemMeta = await this.prisma.announcementItem.findUnique({
        where: { id: itemId },
        select: {
          title: true,
          announcementId: true,
          announcement: { select: { sourceSystem: true, externalId: true } },
        },
      });

      const entityTitle = itemMeta
        ? `[${itemMeta.announcement.sourceSystem}] ${itemMeta.title}`
        : itemId;

      const logId = await this.jobLogger.start({
        type: "REPORT",
        jobId: job.id,
        jobName: job.name,
        entityId: itemId,
        entityTitle,
        payload: {
          itemId,
          announcementId: itemMeta?.announcementId ?? null,
          source: itemMeta?.announcement.sourceSystem ?? null,
          externalId: itemMeta?.announcement.externalId ?? null,
        },
      });

      try {
        const result = await this.embeddingService.generateItemReport(itemId);
        const queuedAnnouncementReport = await this.embeddingService.queueAnnouncementReportIfReady(
          result.announcementId,
        );
        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: {
            itemId,
            announcementId: result.announcementId,
            kind: result.kind,
            summary: result.summary,
            reportLength: result.detailedReport.length,
            estimatedValue: result.estimatedValue,
            queuedAnnouncementReport,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
        throw err;
      }
      return;
    }

    if (job.name === EmbeddingJob.REPORT_ANNOUNCEMENT) {
      this.logger.debug(`Processing REPORT_ANNOUNCEMENT for announcement ${announcementId}`);

      const announcementMeta = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        select: {
          title: true,
          sourceSystem: true,
          externalId: true,
        },
      });

      const entityTitle = announcementMeta
        ? `[${announcementMeta.sourceSystem}] ${announcementMeta.title}`
        : announcementId;

      const logId = await this.jobLogger.start({
        type: "REPORT",
        jobId: job.id,
        jobName: job.name,
        entityId: announcementId,
        entityTitle,
        payload: {
          announcementId,
          source: announcementMeta?.sourceSystem ?? null,
          externalId: announcementMeta?.externalId ?? null,
        },
      });

      try {
        const report = await this.announcementReportService.generateReport(announcementId, {
          log: false,
        });
        const queuedEmbeddings = await this.embeddingService.enqueueEmbeddingJobsForAnnouncement(
          announcementId,
        );
        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: {
            announcementId,
            title: announcementMeta?.title ?? null,
            reportLength: report.length,
            queuedEmbeddings,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
        throw err;
      }
      return;
    }

    if (job.name === EmbeddingJob.EMBED_ITEM) {
      this.logger.debug(`Processing EMBED_ITEM for item ${itemId}`);

      const itemMeta = await this.prisma.announcementItem.findUnique({
        where: { id: itemId },
        select: {
          title: true,
          kind: true,
          announcement: { select: { sourceSystem: true, externalId: true } },
        },
      });

      const entityTitle = itemMeta
        ? `[${itemMeta.announcement.sourceSystem}] ${itemMeta.title}`
        : itemId;

      const logId = await this.jobLogger.start({
        type: "EMBEDDING",
        jobId: job.id,
        jobName: job.name,
        entityId: itemId,
        entityTitle,
        payload: {
          itemId,
          kind: itemMeta?.kind ?? null,
          source: itemMeta?.announcement.sourceSystem ?? null,
          externalId: itemMeta?.announcement.externalId ?? null,
        },
      });

      try {
        await this.embeddingService.generateItemEmbedding(itemId);
        const updatedItem = await this.prisma.announcementItem.findUnique({
          where: { id: itemId },
          select: {
            kind: true,
            shortSummary: true,
            detailedReport: true,
          },
        });
        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: {
            itemId,
            kind: updatedItem?.kind ?? itemMeta?.kind ?? null,
            summary: updatedItem?.shortSummary ?? null,
            reportLength: updatedItem?.detailedReport?.length ?? null,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
        throw err;
      }
      return;
    }

    if (job.name === EmbeddingJob.ENRICH_ITEM) {
      this.logger.debug(`Processing ENRICH_ITEM for item ${itemId}`);

      const logId = await this.jobLogger.start({
        type: "EMBEDDING",
        jobId: job.id,
        jobName: job.name,
        entityId: itemId,
        payload: { itemId, enrichmentType: "attachment_text" },
      });

      try {
        await this.enrichmentService.enrichItem(itemId);
        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: { itemId },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
        throw err;
      }
      return;
    }

    this.logger.warn(`Unknown embedding job name: ${job.name}`);
  }
}

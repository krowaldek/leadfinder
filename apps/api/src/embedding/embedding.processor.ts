import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EmbeddingService } from "./embedding.service.js";
import { AttachmentEnrichmentService } from "./attachment-enrichment.service.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";
import { JobLoggerService } from "../logs/job-logger.service.js";
import { PrismaService } from "../database/prisma.service.js";

interface EmbedItemPayload {
  itemId: string;
}

@Processor(EMBEDDING_QUEUE)
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    @Inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @Inject(AttachmentEnrichmentService)
    private readonly enrichmentService: AttachmentEnrichmentService,
    @Inject(JobLoggerService)
    private readonly jobLogger: JobLoggerService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { itemId } = job.data as EmbedItemPayload;

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
        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: { itemId, kind: itemMeta?.kind ?? null },
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

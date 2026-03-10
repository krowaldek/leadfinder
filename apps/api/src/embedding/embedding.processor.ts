import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EmbeddingService } from "./embedding.service.js";
import { AttachmentEnrichmentService } from "./attachment-enrichment.service.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";

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
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { itemId } = job.data as EmbedItemPayload;

    if (job.name === EmbeddingJob.EMBED_ITEM) {
      this.logger.debug(`Processing EMBED_ITEM for item ${itemId}`);
      await this.embeddingService.generateItemEmbedding(itemId);
      return;
    }

    if (job.name === EmbeddingJob.ENRICH_ITEM) {
      this.logger.debug(`Processing ENRICH_ITEM for item ${itemId}`);
      await this.enrichmentService.enrichItem(itemId);
      return;
    }

    this.logger.warn(`Unknown embedding job name: ${job.name}`);
  }
}

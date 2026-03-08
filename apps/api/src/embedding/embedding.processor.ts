import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EmbeddingService } from "./embedding.service.js";
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
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === EmbeddingJob.EMBED_ITEM) {
      const { itemId } = job.data as EmbedItemPayload;
      this.logger.debug(`Processing embed job for item ${itemId}`);
      await this.embeddingService.generateItemEmbedding(itemId);
    }
  }
}

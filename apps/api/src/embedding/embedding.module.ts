import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "../database/database.module.js";
import { EmbeddingService } from "./embedding.service.js";
import { EmbeddingProcessor } from "./embedding.processor.js";
import { EMBEDDING_QUEUE } from "./embedding-queue.constants.js";

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: EMBEDDING_QUEUE }),
  ],
  providers: [EmbeddingService, EmbeddingProcessor],
  exports: [EmbeddingService, BullModule],
})
export class EmbeddingModule {}

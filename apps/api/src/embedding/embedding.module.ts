import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "../database/database.module.js";
import { EmbeddingService } from "./embedding.service.js";
import { EmbeddingProcessor } from "./embedding.processor.js";
import { EMBEDDING_QUEUE } from "./embedding-queue.constants.js";
import { LogsModule } from "../logs/logs.module.js";
import { ClientMatchingModule } from "../clients/client-matching.module.js";

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: EMBEDDING_QUEUE }),
    LogsModule,
    ClientMatchingModule,
  ],
  providers: [EmbeddingService, EmbeddingProcessor],
  exports: [EmbeddingService, BullModule],
})
export class EmbeddingModule {}

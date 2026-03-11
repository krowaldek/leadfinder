import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "../database/database.module.js";
import { EMBEDDING_QUEUE } from "../embedding/embedding-queue.constants.js";
import { JobLoggerService } from "./job-logger.service.js";
import { LogsService } from "./logs.service.js";
import { LogsController } from "./logs.controller.js";

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: EMBEDDING_QUEUE })],
  controllers: [LogsController],
  providers: [JobLoggerService, LogsService],
  exports: [JobLoggerService, LogsService],
})
export class LogsModule {}

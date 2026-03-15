import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "../database/database.module.js";
import { CLIENT_MATCHING_QUEUE } from "../clients/client-matching.constants.js";
import { EMBEDDING_QUEUE } from "../embedding/embedding-queue.constants.js";
import { SCRAPER_QUEUE } from "../scrapers/scraper-queue.constants.js";
import { JobLoggerService } from "./job-logger.service.js";
import { LogsService } from "./logs.service.js";
import { LogsController } from "./logs.controller.js";

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: EMBEDDING_QUEUE }),
    BullModule.registerQueue({ name: SCRAPER_QUEUE }),
    BullModule.registerQueue({ name: CLIENT_MATCHING_QUEUE }),
  ],
  controllers: [LogsController],
  providers: [JobLoggerService, LogsService],
  exports: [JobLoggerService, LogsService],
})
export class LogsModule {}

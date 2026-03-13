import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BkScraperService } from "./bk/bk.scraper.service.js";
import { EzScraperService } from "./ez/ez.scraper.service.js";
import { PzScraperService } from "./pz/pz.scraper.service.js";
import { ScraperProcessor } from "./scraper.processor.js";
import { ScraperController } from "./scraper.controller.js";
import { ScraperQueueModule } from "./scraper-queue.module.js";
import { SCRAPER_QUEUE } from "./scraper-queue.constants.js";
import { NormalizationModule } from "../normalization/normalization.module.js";
import { EmbeddingModule } from "../embedding/embedding.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { LogsModule } from "../logs/logs.module.js";

@Module({
  imports: [
    ScraperQueueModule,
    BullModule.registerQueue({ name: SCRAPER_QUEUE }),
    NormalizationModule,
    EmbeddingModule,
    DatabaseModule,
    LogsModule,
  ],
  providers: [BkScraperService, EzScraperService, PzScraperService, ScraperProcessor],
  controllers: [ScraperController],
  exports: [BkScraperService, EzScraperService, PzScraperService],
})
export class ScrapersModule {}

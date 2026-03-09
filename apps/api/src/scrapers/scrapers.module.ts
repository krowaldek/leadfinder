import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BkScraperService } from "./bk/bk.scraper.service.js";
import { ScraperProcessor } from "./scraper.processor.js";
import { ScraperController } from "./scraper.controller.js";
import { ScraperQueueModule } from "./scraper-queue.module.js";
import { SCRAPER_QUEUE } from "./scraper-queue.constants.js";
import { NormalizationModule } from "../normalization/normalization.module.js";
import { EmbeddingModule } from "../embedding/embedding.module.js";
import { DatabaseModule } from "../database/database.module.js";

@Module({
  imports: [
    ScraperQueueModule,
    BullModule.registerQueue({ name: SCRAPER_QUEUE }),
    NormalizationModule,
    EmbeddingModule,
    DatabaseModule,
  ],
  providers: [BkScraperService, ScraperProcessor],
  controllers: [ScraperController],
  exports: [BkScraperService],
})
export class ScrapersModule {}

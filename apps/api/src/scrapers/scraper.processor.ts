import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { BkScraperService } from "./bk/bk.scraper.service.js";
import { SCRAPER_QUEUE, ScraperJob } from "./scraper-queue.constants.js";

@Processor(SCRAPER_QUEUE, { concurrency: 1 })
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    @Inject(BkScraperService)
    private readonly bkScraper: BkScraperService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing job: ${job.name} (id=${job.id})`);

    switch (job.name) {
      case ScraperJob.BK_SYNC:
        await this.bkScraper.run();
        break;

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }
}

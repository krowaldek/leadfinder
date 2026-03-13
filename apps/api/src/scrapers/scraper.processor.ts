import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { BkScraperService } from "./bk/bk.scraper.service.js";
import { EzScraperService } from "./ez/ez.scraper.service.js";
import { PzScraperService } from "./pz/pz.scraper.service.js";
import { SCRAPER_QUEUE, ScraperJob } from "./scraper-queue.constants.js";
import { JobLoggerService } from "../logs/job-logger.service.js";

@Processor(SCRAPER_QUEUE, { concurrency: 1 })
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    @Inject(BkScraperService)
    private readonly bkScraper: BkScraperService,
    @Inject(EzScraperService)
    private readonly ezScraper: EzScraperService,
    @Inject(PzScraperService)
    private readonly pzScraper: PzScraperService,
    @Inject(JobLoggerService)
    private readonly jobLogger: JobLoggerService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing job: ${job.name} (id=${job.id})`);

    switch (job.name) {
      case ScraperJob.BK_SYNC: {
        const logId = await this.jobLogger.start({
          type: "SCRAPER",
          jobId: job.id,
          jobName: job.name,
          payload: { source: "BAZA_KONKURENCYJNOSCI", triggeredAt: new Date().toISOString() },
        });
        try {
          const result = await this.bkScraper.run();
          await this.jobLogger.finish({
            logId,
            status: "COMPLETED",
            result: {
              source: "BAZA_KONKURENCYJNOSCI",
              discovered: result.discovered,
              saved: result.saved,
              failed: result.failed,
              skipped: result.skipped,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.jobLogger.finish({ logId, status: "FAILED", error: message });
          throw err;
        }
        break;
      }

      case ScraperJob.EZ_SYNC: {
        const logId = await this.jobLogger.start({
          type: "SCRAPER",
          jobId: job.id,
          jobName: job.name,
          payload: { source: "E_ZAMOWIENIA", triggeredAt: new Date().toISOString() },
        });
        try {
          const result = await this.ezScraper.run();
          await this.jobLogger.finish({
            logId,
            status: "COMPLETED",
            result: {
              source: "E_ZAMOWIENIA",
              discovered: result.discovered,
              saved: result.saved,
              failed: result.failed,
              skipped: result.skipped,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.jobLogger.finish({ logId, status: "FAILED", error: message });
          throw err;
        }
        break;
      }

      case ScraperJob.PZ_SYNC: {
        const logId = await this.jobLogger.start({
          type: "SCRAPER",
          jobId: job.id,
          jobName: job.name,
          payload: { source: "PLATFORMA_ZAKUPOWA", triggeredAt: new Date().toISOString() },
        });
        try {
          const result = await this.pzScraper.run();
          await this.jobLogger.finish({
            logId,
            status: "COMPLETED",
            result: {
              source: "PLATFORMA_ZAKUPOWA",
              discovered: result.discovered,
              saved: result.saved,
              failed: result.failed,
              skipped: result.skipped,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.jobLogger.finish({ logId, status: "FAILED", error: message });
          throw err;
        }
        break;
      }

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }
}

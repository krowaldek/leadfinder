import { BullModule } from "@nestjs/bullmq";
import { Global, Module, Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SCRAPER_QUEUE, ScraperJob } from "./scraper-queue.constants.js";
import type { AppEnv } from "../config/env.js";

@Injectable()
export class ScraperScheduleService implements OnModuleInit {
  constructor(
    @InjectQueue(SCRAPER_QUEUE)
    private readonly queue: Queue,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {}

  async onModuleInit() {
    await this.registerSchedules();
  }

  async registerSchedules(cron?: string) {
    const pattern = cron ?? this.config.get<string>("BK_SCRAPER_CRON") ?? "0 6 * * *";

    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === ScraperJob.BK_SYNC) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      ScraperJob.BK_SYNC,
      {},
      {
        repeat: { pattern },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    );

    return pattern;
  }
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService<AppEnv>) => {
        const redisUrl = config.get<string>("REDIS_URL") ?? "redis://localhost:6380";
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            password: url.password || undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: SCRAPER_QUEUE }),
  ],
  providers: [ScraperScheduleService],
  exports: [BullModule, ScraperScheduleService],
})
export class ScraperQueueModule {}

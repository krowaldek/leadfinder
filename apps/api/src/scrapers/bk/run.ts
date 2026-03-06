/**
 * Uruchomienie scrapera BK jednorazowo z linii komend:
 *   node --import tsx src/scrapers/bk/run.ts
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "../../app.module.js";
import { BkScraperService } from "./bk.scraper.service.js";

async function main() {
  const logger = new Logger("BkScraperRunner");
  logger.log("Bootstrapping NestJS application context...");

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "warn", "error"],
  });

  const scraper = app.get(BkScraperService);

  try {
    await scraper.run();
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error("BK scraper run failed:", err);
  process.exit(1);
});

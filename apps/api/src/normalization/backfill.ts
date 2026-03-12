/**
 * Backfill: processAnnouncement dla wszystkich istniejących ogłoszeń.
 * Uruchom: node --import tsx src/normalization/backfill.ts
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { NormalizationService } from "./normalization.service.js";
import { PrismaService } from "../database/prisma.service.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error", "log"],
  });

  const prisma = app.get(PrismaService);
  const normalization = app.get(NormalizationService);

  const announcements = await prisma.announcement.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Processing ${announcements.length} announcements...`);

  let ok = 0;
  let fail = 0;

  for (const a of announcements) {
    try {
      await normalization.processAnnouncement(a.id);
      ok++;
      if (ok % 10 === 0) {
        console.log(`  ✓ ${ok}/${announcements.length}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${a.id} (${a.title?.slice(0, 50)}): ${msg.slice(0, 80)}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} OK, ${fail} failed`);

  const total = await prisma.announcement.count();
  console.log(`Total announcements in DB: ${total}`);

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

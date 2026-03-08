/**
 * Manualny runner do testowania NormalizationService.
 * Uruchom: pnpm normalization:test
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { NormalizationService } from "./normalization.service.js";
import { PrismaService } from "../database/prisma.service.js";

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ["log", "warn", "error"],
});

const normSvc = app.get(NormalizationService);
const prisma = app.get(PrismaService);

type AnnRow = { id: string; title: string };

// Ogłoszenie z wieloma częściami
const multi = await prisma.$queryRaw<AnnRow[]>`
  SELECT id, title FROM announcements
  WHERE jsonb_array_length("rawData"->'orders') > 1
  LIMIT 1
`;

if (multi.length > 0) {
  const { id, title } = multi[0];
  console.log(`\n=== MULTI-PART ===\n${title}\n(${id})`);
  await normSvc.processAnnouncementToItems(id);
  const items = await prisma.announcementItem.findMany({
    where: { announcementId: id },
    orderBy: { itemIndex: "asc" },
    select: { itemIndex: true, title: true, searchContext: true, price: true, status: true },
  });
  items.forEach((i) => {
    console.log(`\n[${i.itemIndex}] ${i.title.slice(0, 70)}`);
    console.log(`  CTX: ${i.searchContext.slice(0, 130)}…`);
    console.log(`  price: ${i.price ?? "—"} | status: ${i.status}`);
  });
}

// Ogłoszenie bez parts (orders == [])
const single = await prisma.$queryRaw<AnnRow[]>`
  SELECT id, title FROM announcements
  WHERE jsonb_array_length("rawData"->'orders') = 0
  LIMIT 1
`;

if (single.length > 0) {
  const { id, title } = single[0];
  console.log(`\n\n=== SINGLE (no orders) ===\n${title}\n(${id})`);
  await normSvc.processAnnouncementToItems(id);
  const items = await prisma.announcementItem.findMany({
    where: { announcementId: id },
    select: { itemIndex: true, title: true, searchContext: true },
  });
  items.forEach((i) => {
    console.log(`\n[${i.itemIndex}] ${i.title.slice(0, 70)}`);
    console.log(`  CTX: ${i.searchContext.slice(0, 130)}…`);
  });
}

await app.close();
process.exit(0);

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
  await normSvc.processAnnouncement(id);
  const parts = await prisma.announcement.findMany({
    where: { externalId: id },
    orderBy: { partIndex: "asc" },
    select: { partIndex: true, title: true, searchContext: true, embeddingStatus: true },
  });
  parts.forEach((p) => {
    console.log(`\n[${p.partIndex}] ${p.title.slice(0, 70)}`);
    console.log(`  CTX: ${p.searchContext.slice(0, 130)}\u2026`);
    console.log(`  status: ${p.embeddingStatus}`);
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
  await normSvc.processAnnouncement(id);
  const parts = await prisma.announcement.findMany({
    where: { externalId: id },
    select: { partIndex: true, title: true, searchContext: true },
  });
  parts.forEach((p) => {
    console.log(`\n[${p.partIndex}] ${p.title.slice(0, 70)}`);
    console.log(`  CTX: ${p.searchContext.slice(0, 130)}\u2026`);
  });
}

await app.close();
process.exit(0);

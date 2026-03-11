import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMBEDDING_QUEUE } from "./embedding-queue.constants.js";

interface CliOptions {
  execute: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    execute: argv.includes("--execute"),
    force: argv.includes("--force"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error", "log"],
  });

  const prisma = app.get(PrismaService);
  const queue = app.get<Queue>(getQueueToken(EMBEDDING_QUEUE));

  const [itemStats, announcementStats, clientMatchCount, queueCounts] = await Promise.all([
    prisma.announcementItem.aggregate({
      _count: { _all: true },
      where: {},
    }),
    prisma.announcement.aggregate({
      _count: { _all: true },
      where: {},
    }),
    prisma.clientMatch.count(),
    queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
  ]);

  const [itemsWithDerivedState, announcementsWithReports] = await Promise.all([
    prisma.announcementItem.count({
      where: {
        OR: [
          { kind: { not: null } },
          { shortSummary: { not: null } },
          { detailedReport: { not: null } },
          { llmEstimatedValue: { not: null } },
          { status: { not: "PENDING" } },
        ],
      },
    }),
    prisma.announcement.count({
      where: {
        detailedReport: { not: null },
      },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        execute: options.execute,
        force: options.force,
        totals: {
          announcements: announcementStats._count._all,
          items: itemStats._count._all,
          clientMatches: clientMatchCount,
        },
        willReset: {
          itemsWithDerivedState,
          announcementsWithReports,
          itemEmbeddingsAssumed: itemStats._count._all,
          announcementEmbeddingsAssumed: announcementStats._count._all,
          clientMatches: clientMatchCount,
        },
        queue: queueCounts,
      },
      null,
      2,
    ),
  );

  if (!options.execute) {
    console.log("Dry run only. Re-run with --execute to reset derived state.");
    await app.close();
    return;
  }

  if (queueCounts.active > 0 && !options.force) {
    throw new Error(
      `Embedding queue has ${queueCounts.active} active job(s). Re-run with --force to clear queue and reset anyway.`,
    );
  }

  await queue.pause();
  await queue.obliterate({ force: true });

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE announcement_items
      SET
        embedding = NULL,
        kind = NULL,
        "shortSummary" = NULL,
        "detailedReport" = NULL,
        "llmEstimatedValue" = NULL,
        status = 'PENDING'::"AnnouncementItemStatus",
        "updatedAt" = NOW()
    `,
    prisma.$executeRaw`
      UPDATE announcements
      SET
        embedding = NULL,
        "detailedReport" = NULL,
        "updatedAt" = NOW()
    `,
    prisma.clientMatch.deleteMany({}),
  ]);

  await queue.resume();

  console.log(
    "Reset complete. Raw announcements and items were preserved; derived embedding/report state was cleared.",
  );

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
/**
 * Safe announcement re-embedding backfill.
 *
 * Examples:
 *   pnpm items:reembed -- --mode full
 *   pnpm items:reembed -- --mode full --execute
 *   pnpm items:reembed -- --mode targeted --source BAZA_KONKURENCYJNOSCI --limit 200 --execute
 *   pnpm items:reembed -- --mode targeted --announcement-id <uuid> --execute
 */

import { getQueueToken } from "@nestjs/bullmq";
import { NestFactory } from "@nestjs/core";
import type { Queue } from "bullmq";
import "reflect-metadata";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";

const VALID_SOURCES = [
  "BAZA_KONKURENCYJNOSCI",
  "E_ZAMOWIENIA",
  "PLATFORMA_ZAKUPOWA",
] as const;

const VALID_ITEM_STATUSES = ["PENDING", "EMBEDDED", "ERROR"] as const;

type SourceSystem = (typeof VALID_SOURCES)[number];
type Mode = "full" | "targeted";
type AnnouncementStatus = (typeof VALID_ITEM_STATUSES)[number];

interface CliOptions {
  mode: Mode;
  execute: boolean;
  limit: number | null;
  onlyEmbedded: boolean;
  readyForEmbedOnly: boolean;
  statuses: AnnouncementStatus[];
  sourceSystems: SourceSystem[];
  announcementIds: string[];
  itemIds: string[];
}

function parseListArg(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const [rawKey, inlineValue] = current.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(rawKey, true);
      continue;
    }

    args.set(rawKey, next);
    index += 1;
  }

  const modeValue = args.get("mode");
  const mode: Mode = modeValue === "targeted" ? "targeted" : "full";
  const limitRaw = args.get("limit");
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : null;
  const sourceSystems = parseListArg(
    typeof args.get("source") === "string"
      ? String(args.get("source"))
      : undefined,
  ).filter((value): value is SourceSystem =>
    VALID_SOURCES.includes(value as SourceSystem),
  );
  const statuses = parseListArg(
    typeof args.get("status") === "string"
      ? String(args.get("status"))
      : undefined,
  ).filter((value): value is AnnouncementStatus =>
    VALID_ITEM_STATUSES.includes(value as AnnouncementStatus),
  );
  const announcementIds = parseListArg(
    typeof args.get("announcement-id") === "string"
      ? String(args.get("announcement-id"))
      : undefined,
  );
  const itemIds = parseListArg(
    typeof args.get("item-id") === "string"
      ? String(args.get("item-id"))
      : undefined,
  );

  if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  if (
    mode === "targeted" &&
    statuses.length === 0 &&
    sourceSystems.length === 0 &&
    announcementIds.length === 0 &&
    itemIds.length === 0 &&
    limit == null
  ) {
    throw new Error(
      "Targeted mode requires at least one selector: --status, --source, --announcement-id, --item-id or --limit",
    );
  }

  return {
    mode,
    execute: args.has("execute"),
    limit,
    onlyEmbedded: args.has("only-embedded"),
    readyForEmbedOnly: args.has("ready-for-embed-only"),
    statuses,
    sourceSystems,
    announcementIds,
    itemIds,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error", "log"],
  });

  const prisma = app.get(PrismaService);
  const queue = app.get<Queue>(getQueueToken(EMBEDDING_QUEUE));

  const where = {
    ...(options.itemIds.length > 0 ? { id: { in: options.itemIds } } : {}),
    ...(options.announcementIds.length > 0
      ? { id: { in: options.announcementIds } }
      : {}),
    ...(options.onlyEmbedded
      ? { embeddingStatus: "EMBEDDED" as const }
      : options.statuses.length > 0
        ? { embeddingStatus: { in: options.statuses } }
        : {}),
    ...(options.sourceSystems.length > 0
      ? {
          sourceSystem: { in: options.sourceSystems },
        }
      : {}),
  };

  const items = await prisma.announcement.findMany({
    where,
    select: {
      id: true,
      title: true,
      embeddingStatus: true,
      kind: true,
      detailedReport: true,
      sourceSystem: true,
    },
    orderBy: [{ updatedAt: "asc" }, { partIndex: "asc" }],
    ...(options.limit != null ? { take: options.limit } : {}),
  });

  const readyForEmbed = items.filter(
    (item) => item.kind && item.detailedReport,
  );
  const needsReport = items.filter(
    (item) => !item.kind || !item.detailedReport,
  );
  const selectedItems = options.readyForEmbedOnly ? readyForEmbed : items;

  console.log(
    JSON.stringify(
      {
        mode: options.mode,
        execute: options.execute,
        onlyEmbedded: options.onlyEmbedded,
        readyForEmbedOnly: options.readyForEmbedOnly,
        selectors: {
          statuses: options.statuses,
          sourceSystems: options.sourceSystems,
          announcementIds: options.announcementIds,
          itemIds: options.itemIds,
          limit: options.limit,
        },
        selectedItems: selectedItems.length,
        queueReportJobs: options.readyForEmbedOnly ? 0 : needsReport.length,
        queueEmbedJobs: selectedItems.filter(
          (item) => item.kind && item.detailedReport,
        ).length,
        skippedMissingReportItems: options.readyForEmbedOnly
          ? needsReport.length
          : 0,
        sample: selectedItems.slice(0, 5).map((item) => ({
          announcementId: item.id,
          announcementStatus: item.embeddingStatus,
          sourceSystem: item.sourceSystem,
          announcementTitle: item.title.slice(0, 80),
          nextJob: EmbeddingJob.EMBED_ANNOUNCEMENT,
        })),
      },
      null,
      2,
    ),
  );

  if (!options.execute) {
    console.log("Dry run only. Re-run with --execute to queue jobs.");
    await app.close();
    return;
  }

  const runId = Date.now();
  let queued = 0;

  for (const item of selectedItems) {
    const jobName = EmbeddingJob.EMBED_ANNOUNCEMENT;

    await queue.add(
      jobName,
      { announcementId: item.id },
      {
        jobId: `${jobName.replace(/\./g, "-")}-manual-${item.id}-${runId}`,
        priority: 10,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );

    queued += 1;
    if (queued % 100 === 0) {
      console.log(`Queued ${queued}/${items.length} jobs...`);
    }
  }

  console.log(`Queued ${queued} re-embed job(s) into ${EMBEDDING_QUEUE}.`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

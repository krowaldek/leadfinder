import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { LogsService } from "../logs/logs.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { ClientMatchingService } from "./client-matching.service.js";

interface CliOptions {
  intervalMs: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const [key, inlineValue] = current.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  const intervalSeconds = Number(args.get("interval-seconds") ?? "30");
  const timeoutMinutes = Number(args.get("timeout-minutes") ?? "360");

  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("--interval-seconds must be a positive number");
  }

  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error("--timeout-minutes must be a positive number");
  }

  return {
    intervalMs: intervalSeconds * 1000,
    timeoutMs: timeoutMinutes * 60 * 1000,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPipeline(logsService: LogsService, options: CliOptions) {
  const startedAt = Date.now();

  for (;;) {
    const progress = await logsService.getReembedProgress();
    const { summary, queue } = progress;

    console.log(
      `[watch] embedded=${summary.embeddedWithReport}/${summary.totalItems} | reports=${summary.itemsWithReport}/${summary.totalItems} | queue waiting=${queue.waiting} active=${queue.active} failed=${queue.failed}`,
    );

    if (summary.errorItems > 0 || queue.failed > 0) {
      throw new Error(
        `Pipeline has failures: errorItems=${summary.errorItems}, queueFailed=${queue.failed}`,
      );
    }

    const queueIdle = queue.waiting === 0 && queue.active === 0 && queue.delayed === 0;
    const allEmbedded = summary.totalItems > 0 && summary.embeddedWithReport === summary.totalItems;

    if (queueIdle && allEmbedded) {
      console.log("[watch] Report-first pipeline completed successfully.");
      return;
    }

    if (queueIdle && !allEmbedded) {
      throw new Error(
        `Queue is idle but pipeline is incomplete: embeddedWithReport=${summary.embeddedWithReport}/${summary.totalItems}`,
      );
    }

    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error("Timed out while waiting for report-first pipeline completion");
    }

    await sleep(options.intervalMs);
  }
}

async function runClientBackfill(
  prisma: PrismaService,
  clientMatchingService: ClientMatchingService,
) {
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, companyName: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[backfill] Processing ${clients.length} active client(s)...`);

  let ok = 0;
  let fail = 0;

  for (const client of clients) {
    try {
      const matchCount = await clientMatchingService.matchClient(client.id);
      ok += 1;
      console.log(`[backfill] ✓ ${client.companyName} — ${matchCount} matches`);
    } catch (error) {
      fail += 1;
      console.error(
        `[backfill] ✗ ${client.companyName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(`[backfill] Done: ${ok} OK, ${fail} failed`);

  if (fail > 0) {
    throw new Error(`Client backfill failed for ${fail} client(s)`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error", "log"],
  });

  const logsService = app.get(LogsService);
  const prisma = app.get(PrismaService);
  const clientMatchingService = app.get(ClientMatchingService);

  try {
    await waitForPipeline(logsService, options);
    await runClientBackfill(prisma, clientMatchingService);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
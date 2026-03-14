import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error", "log"],
  });

  const prisma = app.get(PrismaService);
  const queue = app.get<Queue>(getQueueToken(EMBEDDING_QUEUE));
  const runId = Date.now();

  // Re-queue announcements that are missing analysis or embedding
  const pending = await prisma.announcement.findMany({
    where: {
      OR: [
        { kind: null },
        { detailedReport: null },
        { embeddingStatus: { not: "EMBEDDED" } },
      ],
    },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  let queued = 0;
  for (const announcement of pending) {
    await queue.add(
      EmbeddingJob.EMBED_ANNOUNCEMENT,
      { announcementId: announcement.id },
      {
        jobId: `announcement-embed-resume-${announcement.id}-${runId}`,
        priority: 10,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    queued += 1;
  }

  console.log(JSON.stringify({ queued }, null, 2));

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

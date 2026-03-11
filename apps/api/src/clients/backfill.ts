/**
 * One-off backfill: regenerate synthetic announcements and requeue matching for existing clients.
 * Run: node --import tsx src/clients/backfill.ts
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { ClientMatchingService } from "./client-matching.service.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error", "log"],
  });

  const prisma = app.get(PrismaService);
  const clientMatchingService = app.get(ClientMatchingService);
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, companyName: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `Processing direct synthetic-announcement backfill for ${clients.length} active client(s)...`,
  );

  let ok = 0;
  let fail = 0;

  for (const client of clients) {
    try {
      await prisma.$executeRaw`
        UPDATE clients
        SET "profileEmbedding" = NULL,
            "syntheticAnnouncementText" = NULL,
            "updatedAt" = NOW()
        WHERE id = ${client.id}::uuid
      `;
      const matchCount = await clientMatchingService.matchClient(client.id);
      ok++;
      console.log(`  ✓ ${client.companyName} — ${matchCount} matches`);
    } catch (error) {
      fail++;
      console.error(
        `  ✗ ${client.companyName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(`Done: ${ok} OK, ${fail} failed`);

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
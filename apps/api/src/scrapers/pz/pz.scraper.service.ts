import { Injectable, Logger, Inject } from "@nestjs/common";
import axios, { AxiosError } from "axios";
import { parse } from "csv-parse/sync";
import pLimit from "p-limit";
import { AnnouncementSource } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { NormalizationService } from "../../normalization/normalization.service.js";
import { mapPzRowToUpsertData, getPzExternalId, type PzCsvRow } from "./pz.mapper.js";

const PZ_CSV_URL = "https://platformazakupowa.pl/transakcje-ON-eksport.csv";
const CONCURRENCY_LIMIT = 3;

@Injectable()
export class PzScraperService {
  private readonly logger = new Logger(PzScraperService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(NormalizationService)
    private readonly normalization: NormalizationService,
  ) {}

  async run(): Promise<{ discovered: number; saved: number; failed: number; skipped: boolean }> {
    this.logger.log("PZ scraper run started");

    const fetchedRows = await this.fetchRows();
    if (fetchedRows.length === 0) {
      this.logger.log("PZ: CSV empty — no new proceedings in the last hour");
      await this.updateMetadata();
      return { discovered: 0, saved: 0, failed: 0, skipped: false };
    }

    const dedupedRows = dedupeRows(fetchedRows);
    const newRows = await this.discoverNewRows(dedupedRows);

    if (newRows.length === 0) {
      this.logger.log("PZ: nothing new");
      await this.updateMetadata(dedupedRows.at(-1) ? getPzExternalId(dedupedRows.at(-1)!) : undefined);
      return { discovered: 0, saved: 0, failed: 0, skipped: false };
    }

    const limit = pLimit(CONCURRENCY_LIMIT);
    const tasks = newRows.map((row) => limit(() => this.saveRow(row)));
    const results = await Promise.allSettled(tasks);

    const failed = results.filter((result) => result.status === "rejected").length;
    const saved = results.length - failed;

    this.logger.log(`PZ: run complete – ${saved} saved, ${failed} failed`);
    await this.updateMetadata(getPzExternalId(newRows.at(-1)!));

    return {
      discovered: newRows.length,
      saved,
      failed,
      skipped: false,
    };
  }

  private async fetchRows(): Promise<PzCsvRow[]> {
    this.logger.log(`PZ: fetching CSV from ${PZ_CSV_URL}`);

    try {
      const response = await axios.get<string>(PZ_CSV_URL, {
        responseType: "text",
        timeout: 30_000,
        transformResponse: [(value) => value],
        headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8" },
      });

      const csvText = response.data?.trim();
      if (!csvText) {
        return [];
      }

      const rows = parse(csvText, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as PzCsvRow[];

      return rows.filter((row) => Boolean(getPzExternalId(row)));
    } catch (err) {
      const message =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status ?? "?"} – ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      this.logger.error(`PZ: failed to fetch CSV: ${message}`);
      throw err;
    }
  }

  private async discoverNewRows(rows: PzCsvRow[]): Promise<PzCsvRow[]> {
    const fetchedIds = rows.map(getPzExternalId);

    const existing = await this.prisma.announcement.findMany({
      where: {
        sourceSystem: AnnouncementSource.PLATFORMA_ZAKUPOWA,
        externalId: { in: fetchedIds },
      },
      select: { externalId: true },
    });

    const existingIds = new Set(existing.map((item) => item.externalId));
    const newRows = rows.filter((row) => !existingIds.has(getPzExternalId(row)));

    this.logger.log(
      `PZ: ${rows.length} fetched, ${existingIds.size} already in DB, ${newRows.length} new`,
    );

    return newRows;
  }

  private async saveRow(row: PzCsvRow): Promise<void> {
    const upsertData = mapPzRowToUpsertData(row);

    try {
      const saved = await this.prisma.announcement.upsert({
        where: {
          sourceSystem_externalId_partIndex: {
            sourceSystem: AnnouncementSource.PLATFORMA_ZAKUPOWA,
            externalId: upsertData.externalId,
            partIndex: 0,
          },
        },
        create: upsertData,
        update: {
          title: upsertData.title,
          description: upsertData.description,
          url: upsertData.url,
          status: upsertData.status,
          valueMin: upsertData.valueMin,
          valueMax: upsertData.valueMax,
          publishedAt: upsertData.publishedAt,
          deadlineAt: upsertData.deadlineAt,
          rawData: upsertData.rawData,
        },
        select: { id: true },
      });

      this.logger.log(`PZ: saved ${upsertData.externalId}`);

      try {
        await this.normalization.processAnnouncement(saved.id);
      } catch (normErr) {
        const message = normErr instanceof Error ? normErr.message : String(normErr);
        this.logger.warn(
          `PZ: normalization failed for ${upsertData.externalId} (${saved.id}): ${message}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PZ: failed to save ${upsertData.externalId}: ${message}`);
      throw err;
    }
  }

  private async updateMetadata(lastItemId?: string): Promise<void> {
    await this.prisma.scraperMetadata.upsert({
      where: { providerName: AnnouncementSource.PLATFORMA_ZAKUPOWA },
      create: {
        providerName: AnnouncementSource.PLATFORMA_ZAKUPOWA,
        lastSyncedAt: new Date(),
        lastProcessedItemId: lastItemId ?? null,
      },
      update: {
        lastSyncedAt: new Date(),
        ...(lastItemId != null ? { lastProcessedItemId: lastItemId } : {}),
      },
    });
  }
}

function dedupeRows(rows: PzCsvRow[]): PzCsvRow[] {
  const map = new Map<string, PzCsvRow>();
  for (const row of rows) {
    map.set(getPzExternalId(row), row);
  }
  return [...map.values()];
}

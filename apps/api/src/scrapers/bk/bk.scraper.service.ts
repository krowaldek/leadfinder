import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosError } from "axios";
import pLimit from "p-limit";
import { AnnouncementSource } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { NormalizationService } from "../../normalization/normalization.service.js";
import {
  mapBkDetailToUpsertData,
  type BkSearchResponse,
  type BkDetailResponse,
  type BkListItem,
} from "./bk.mapper.js";
import type { AppEnv } from "../../config/env.js";

const CONCURRENCY_LIMIT = 3;

@Injectable()
export class BkScraperService {
  private readonly logger = new Logger(BkScraperService.name);
  private readonly apiBaseUrl?: string;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(NormalizationService)
    private readonly normalization: NormalizationService,
  ) {
    const url = this.config.get<string>("BK_API_BASE_URL");
    if (url) {
      this.apiBaseUrl = url;
      return;
    }

    this.logger.warn(
      "BK_API_BASE_URL is not configured. BK scraper is disabled until this env var is provided.",
    );
  }

  // ---------------------------------------------------------------------------
  // Step 1 – discover IDs not yet in the database
  // ---------------------------------------------------------------------------

  async discoverNewIds(): Promise<{ newIds: string[]; listItems: BkListItem[] }> {
    if (!this.apiBaseUrl) {
      this.logger.warn("BK scraper is disabled: missing BK_API_BASE_URL.");
      return { newIds: [], listItems: [] };
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const url =
      `${this.apiBaseUrl}/announcements/search` +
      `?page=1&limit=100&sort=default` +
      `&submissionDeadlineRange%5Bfrom%5D=${today}` +
      `&status%5B0%5D=PUBLISHED`;

    this.logger.log(`Fetching BK list: ${url}`);

    const { data: envelope } = await axios.get<BkSearchResponse>(url);
    const items = envelope.data?.advertisements ?? [];

    if (items.length === 0) {
      this.logger.log("BK list returned 0 items");
      return { newIds: [], listItems: [] };
    }

    const fetchedIds = items.map((item) => String(item.id));

    const existing = await this.prisma.announcement.findMany({
      where: {
        sourceSystem: AnnouncementSource.BAZA_KONKURENCYJNOSCI,
        externalId: { in: fetchedIds },
      },
      select: { externalId: true },
    });

    const existingIds = new Set(existing.map((a) => a.externalId));
    const newIds = fetchedIds.filter((id) => !existingIds.has(id));

    this.logger.log(
      `BK: ${fetchedIds.length} fetched, ${existingIds.size} already in DB, ${newIds.length} new`,
    );

    return { newIds, listItems: items };
  }

  // ---------------------------------------------------------------------------
  // Step 2 – fetch detail and upsert into announcements table
  // ---------------------------------------------------------------------------

  async fetchAndSaveDetails(id: string, listContent?: string | null): Promise<void> {
    if (!this.apiBaseUrl) {
      this.logger.warn("BK scraper is disabled: missing BK_API_BASE_URL.");
      return;
    }

    const url = `${this.apiBaseUrl}/announcements/${id}`;

    try {
      const { data: envelope } = await axios.get<BkDetailResponse>(url);
      const detail = envelope.data?.advertisement;

      if (!detail) {
        this.logger.warn(`BK: empty detail response for ${id}`);
        return;
      }

      const upsertData = mapBkDetailToUpsertData(id, detail, listContent);

      const saved = await this.prisma.announcement.upsert({
        where: {
          sourceSystem_externalId: {
            sourceSystem: AnnouncementSource.BAZA_KONKURENCYJNOSCI,
            externalId: id,
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

      this.logger.log(`BK: saved ${id}`);

      try {
        await this.normalization.processAnnouncementToItems(saved.id);
      } catch (normErr) {
        const msg =
          normErr instanceof Error ? normErr.message : String(normErr);
        this.logger.warn(
          `BK: normalization failed for ${id} (${saved.id}): ${msg}`,
        );
      }
    } catch (err) {
      const message =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status ?? "?"} – ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);

      this.logger.error(`BK: failed to process announcement ${id}: ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Orchestrator – run full sync cycle
  // ---------------------------------------------------------------------------

  async run(): Promise<void> {
    if (!this.apiBaseUrl) {
      this.logger.warn(
        "Skipping BK scraper run because BK_API_BASE_URL is not configured.",
      );
      return;
    }

    this.logger.log("BK scraper run started");

    let newIds: string[];
    let listItems: BkListItem[];

    try {
      ({ newIds, listItems } = await this.discoverNewIds());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`BK: discoverNewIds failed – ${message}`);
      return;
    }

    // Backfill deadlineAt for existing announcements that appeared in the list
    // but were saved before the deadline field was properly populated.
    await this.backfillDeadlines(listItems);

    if (newIds.length === 0) {
      this.logger.log("BK: nothing new, updating metadata");
      await this.updateMetadata();
      return;
    }

    // Zbuduj mapę id → content z danych listy (opis ogłoszenia dostępny tylko w liście, nie w detalu)
    const contentByExternalId = new Map<string, string>();
    for (const item of listItems) {
      if (item.content?.trim()) {
        contentByExternalId.set(String(item.id), item.content.trim());
      }
    }

    const limit = pLimit(CONCURRENCY_LIMIT);
    const tasks = newIds.map((id) =>
      limit(() => this.fetchAndSaveDetails(id, contentByExternalId.get(id))),
    );
    const results = await Promise.allSettled(tasks);

    const failed = results.filter((r) => r.status === "rejected").length;
    this.logger.log(
      `BK: run complete – ${results.length - failed} saved, ${failed} failed`,
    );

    await this.updateMetadata(newIds[0]);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Aktualizuje deadlineAt dla ogłoszeń które pojawiły się w liście BK
   * ale mają null w polu deadlineAt (stare rekordy sprzed poprawki mappera).
   */
  private async backfillDeadlines(listItems: BkListItem[]): Promise<void> {
    const itemsWithDeadline = listItems.filter(
      (item) => item.submission_deadline,
    );

    if (itemsWithDeadline.length === 0) return;

    const updates = itemsWithDeadline.map((item) => ({
      externalId: String(item.id),
      deadlineAt: new Date(item.submission_deadline!),
    }));

    // Tylko aktualizuj rekordy które mają deadlineAt = null
    const toUpdate = await this.prisma.announcement.findMany({
      where: {
        sourceSystem: AnnouncementSource.BAZA_KONKURENCYJNOSCI,
        externalId: { in: updates.map((u) => u.externalId) },
        deadlineAt: null,
      },
      select: { externalId: true },
    });

    if (toUpdate.length === 0) {
      this.logger.log("BK backfillDeadlines: no announcements need deadline update");
      return;
    }

    const toUpdateSet = new Set(toUpdate.map((a) => a.externalId));

    await Promise.all(
      updates
        .filter((u) => toUpdateSet.has(u.externalId))
        .map((u) =>
          this.prisma.announcement.update({
            where: {
              sourceSystem_externalId: {
                sourceSystem: AnnouncementSource.BAZA_KONKURENCYJNOSCI,
                externalId: u.externalId,
              },
            },
            data: { deadlineAt: u.deadlineAt },
          }),
        ),
    );

    this.logger.log(
      `BK backfillDeadlines: updated ${toUpdate.length} announcement deadlines`,
    );
  }

  private async updateMetadata(lastItemId?: string): Promise<void> {
    await this.prisma.scraperMetadata.upsert({
      where: { providerName: AnnouncementSource.BAZA_KONKURENCYJNOSCI },
      create: {
        providerName: AnnouncementSource.BAZA_KONKURENCYJNOSCI,
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

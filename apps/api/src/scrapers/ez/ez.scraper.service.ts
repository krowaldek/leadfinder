import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosError } from "axios";
import pLimit from "p-limit";
import { AnnouncementSource } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { NormalizationService } from "../../normalization/normalization.service.js";
import {
  mapEzNoticeToUpsertData,
  type EzAttachmentLike,
  type EzNotice,
  type EzNoticeSummary,
} from "./ez.mapper.js";

const EZ_API_BASE = "https://ezamowienia.gov.pl/mo-board/api/v1";
const PAGE_SIZE = 100;
const CONCURRENCY_LIMIT = 3;
/** How many days back to look for new notices when no lastSyncedAt recorded */
const DEFAULT_DAYS_BACK = 2;
const EZ_PUBLIC_PROCEEDING_BASE = "https://ezamowienia.gov.pl/mp-client/search/list";
const EZ_NOTICE_DETAILS_BASE = "https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details";

@Injectable()
export class EzScraperService {
  private readonly logger = new Logger(EzScraperService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(NormalizationService)
    private readonly normalization: NormalizationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Step 1 – fetch a page of notices from a date range and filter new ones
  // ---------------------------------------------------------------------------

  async discoverNewNoticesForPage(notices: EzNoticeSummary[]): Promise<EzNoticeSummary[]> {
    if (notices.length === 0) {
      return [];
    }

    const fetchedIds = notices.map((n) => n.objectId);

    const existing = await this.prisma.announcement.findMany({
      where: {
        sourceSystem: AnnouncementSource.E_ZAMOWIENIA,
        externalId: { in: fetchedIds },
      },
      select: { externalId: true, rawData: true },
    });

    const existingIds = new Set(existing.map((a) => a.externalId));
    const enrichedIds = new Set(
      existing
        .filter((announcement) => {
          const rawData = announcement.rawData as { attachments?: unknown } | null;
          return Array.isArray(rawData?.attachments) && rawData.attachments.length > 0;
        })
        .map((announcement) => announcement.externalId),
    );

    const noticesToProcess = notices.filter(
      (notice) => !existingIds.has(notice.objectId) || !enrichedIds.has(notice.objectId),
    );
    const missingAttachments = noticesToProcess.filter((notice) => existingIds.has(notice.objectId)).length;
    const newNotices = noticesToProcess.filter((notice) => !existingIds.has(notice.objectId));

    this.logger.log(
      `EZ: page filter — ${fetchedIds.length} fetched, ${existingIds.size} already in DB, ${newNotices.length} new, ${missingAttachments} need attachment backfill`,
    );

    return noticesToProcess;
  }

  // ---------------------------------------------------------------------------
  // Step 2 – upsert a single notice into the announcements table
  // ---------------------------------------------------------------------------

  async saveNotice(notice: EzNoticeSummary): Promise<void> {
    try {
      const upsertData = mapEzNoticeToUpsertData(notice);

      const saved = await this.prisma.announcement.upsert({
        where: {
          sourceSystem_externalId_partIndex: {
            sourceSystem: AnnouncementSource.E_ZAMOWIENIA,
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

      this.logger.log(`EZ: saved ${notice.objectId}`);

      try {
        await this.normalization.processAnnouncement(saved.id);
      } catch (normErr) {
        const msg = normErr instanceof Error ? normErr.message : String(normErr);
        this.logger.warn(
          `EZ: normalization failed for ${notice.objectId} (${saved.id}): ${msg}`,
        );
      }
    } catch (err) {
      const message =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status ?? "?"} – ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);

      this.logger.error(`EZ: failed to save notice ${notice.objectId}: ${message}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Orchestrator – run full sync cycle
  // ---------------------------------------------------------------------------

  async run(): Promise<{ discovered: number; saved: number; failed: number; skipped: boolean }> {
    this.logger.log("EZ scraper run started");
    const { dateFrom, dateTo } = await this.buildDateRange();

    this.logger.log(`EZ: fetching notices from ${dateFrom} to ${dateTo}`);

    let discovered = 0;
    let saved = 0;
    let failed = 0;
    let page = 1;
    let lastProcessedItemId: string | undefined;
    const limit = pLimit(CONCURRENCY_LIMIT);
    const seenPageSignatures = new Set<string>();

    try {
      while (true) {
        const pageNotices = await this.fetchPage(dateFrom, dateTo, page);

        if (pageNotices.length === 0) {
          if (page === 1) {
            this.logger.log("EZ: list returned 0 notices");
          }
          break;
        }

        const pageSignature = pageNotices.map((notice) => notice.objectId).join(",");
        if (seenPageSignatures.has(pageSignature)) {
          this.logger.warn(
            `EZ: page ${page} repeats a previously seen result set; stopping pagination to avoid an infinite loop`,
          );
          break;
        }
        seenPageSignatures.add(pageSignature);

        const newNotices = await this.discoverNewNoticesForPage(pageNotices);
        discovered += newNotices.length;

        if (newNotices.length > 0) {
          const tasks = newNotices.map((notice) =>
            limit(() => this.saveNotice(notice)),
          );
          const results = await Promise.allSettled(tasks);

          const pageFailed = results.filter((r) => r.status === "rejected").length;
          const pageSaved = results.length - pageFailed;

          saved += pageSaved;
          failed += pageFailed;
          lastProcessedItemId = newNotices.at(-1)?.objectId ?? lastProcessedItemId;

          this.logger.log(
            `EZ: page ${page} complete – ${pageSaved} saved, ${pageFailed} failed (total: ${saved} saved, ${failed} failed)`,
          );
        } else {
          this.logger.log(`EZ: page ${page} complete – 0 new notices`);
        }

        if (pageNotices.length < PAGE_SIZE) {
          break;
        }

        page += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`EZ: run failed – ${message}`);
      throw err;
    }

    if (discovered === 0 && saved === 0 && failed === 0) {
      this.logger.log("EZ: nothing new");
      await this.updateMetadata();
      return { discovered: 0, saved: 0, failed: 0, skipped: false };
    }

    this.logger.log(`EZ: run complete – ${saved} saved, ${failed} failed`);

    await this.updateMetadata(lastProcessedItemId);
    return {
      discovered,
      saved,
      failed,
      skipped: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Fetch a single page for the given date range from ezamowienia API.
   * htmlBody is stripped immediately so the scraper can process pages incrementally.
   */
  private async fetchPage(
    dateFrom: string,
    dateTo: string,
    page: number,
  ): Promise<EzNoticeSummary[]> {
    const url =
      `${EZ_API_BASE}/notice` +
      `?NoticeType=ContractNotice` +
      `&PublicationDateFrom=${encodeURIComponent(dateFrom)}` +
      `&PublicationDateTo=${encodeURIComponent(dateTo)}` +
      `&PageNumber=${page}` +
      `&PageSize=${PAGE_SIZE}`;

    this.logger.log(`EZ: fetching page ${page}: ${url}`);

    try {
      const { data: rawNotices } = await axios.get<EzNotice[]>(url, {
        timeout: 30_000,
        headers: { Accept: "application/json" },
      });

      if (!Array.isArray(rawNotices) || rawNotices.length === 0) {
        return [];
      }

      return rawNotices.map((notice) => {
        const attachments = extractEzAttachments(notice);
        const { htmlBody: _dropped, ...rest } = notice;
        return attachments.length > 0 ? { ...rest, attachments } : rest;
      });
    } catch (err) {
      const message =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status ?? "?"} – ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      this.logger.error(`EZ: failed to fetch page ${page}: ${message}`);
      throw err;
    }
  }

  /**
   * Determines the date range for the current sync:
   * - From: lastSyncedAt from ScraperMetadata (if exists) or DEFAULT_DAYS_BACK days ago
   * - To: now
   */
  private async buildDateRange(): Promise<{ dateFrom: string; dateTo: string }> {
    const metadata = await this.prisma.scraperMetadata.findUnique({
      where: { providerName: AnnouncementSource.E_ZAMOWIENIA },
    });

    const now = new Date();
    let fromDate: Date;

    if (metadata?.lastSyncedAt) {
      // Go back 1 hour from the last sync to avoid gaps due to clock skew
      fromDate = new Date(metadata.lastSyncedAt.getTime() - 60 * 60 * 1000);
    } else {
      fromDate = new Date(now.getTime() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000);
    }

    const dateFrom = formatIsoDate(fromDate);
    const dateTo = formatIsoDate(now);

    return { dateFrom, dateTo };
  }

  private async updateMetadata(lastItemId?: string): Promise<void> {
    await this.prisma.scraperMetadata.upsert({
      where: { providerName: AnnouncementSource.E_ZAMOWIENIA },
      create: {
        providerName: AnnouncementSource.E_ZAMOWIENIA,
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

/** Format date to ISO string without milliseconds, e.g. "2026-03-13T00:00:00Z" */
function formatIsoDate(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

function extractEzAttachments(notice: EzNotice): EzAttachmentLike[] {
  const attachments: EzAttachmentLike[] = [];
  const seen = new Set<string>();

  const addAttachment = (url: string | null | undefined, name?: string, type?: string) => {
    if (!url) return;
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    attachments.push({
      url: normalizedUrl,
      name: name ?? buildAttachmentName(normalizedUrl),
      type,
    });
  };

  const htmlBody = notice.htmlBody ?? "";

  for (const match of htmlBody.matchAll(/href=["']([^"']+)["']/gi)) {
    addAttachment(match[1], buildAttachmentName(match[1] ?? undefined));
  }

  for (const match of htmlBody.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    addAttachment(match[0], buildAttachmentName(match[0] ?? undefined));
  }

  if (notice.tenderId?.trim()) {
    addAttachment(
      `${EZ_PUBLIC_PROCEEDING_BASE}/${encodeURIComponent(notice.tenderId)}`,
      `ez-proceeding-${notice.tenderId}.html`,
      "text/html",
    );
  }

  if (notice.noticeNumber?.trim()) {
    addAttachment(
      `${EZ_NOTICE_DETAILS_BASE}/${encodeURIComponent(notice.noticeNumber)}`,
      `ez-notice-${slugifyNoticeNumber(notice.noticeNumber)}.html`,
      "text/html",
    );
  }

  return attachments.filter((attachment) => isSupportedAttachmentCandidate(attachment.url ?? ""));
}

function normalizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function buildAttachmentName(url?: string): string {
  if (!url) return "ez-document.html";

  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "document";
    const hasExtension = /\.[a-z0-9]{2,6}$/i.test(lastSegment);
    if (hasExtension) return decodeURIComponent(lastSegment);

    const host = parsed.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const segment = lastSegment.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
    return `${host}-${segment}.html`;
  } catch {
    return "ez-document.html";
  }
}

function slugifyNoticeNumber(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function isSupportedAttachmentCandidate(url: string): boolean {
  const lower = url.toLowerCase();
  return /(\.pdf|\.docx|\.doc|\.txt|\.html?|\.xml|\.csv|\.json)(\?|#|$)/.test(lower)
    || lower.includes("platformazakupowa.pl")
    || lower.includes("ezamowienia.gov.pl")
    || lower.includes("eb2b.com.pl")
    || lower.includes("bip.");
}

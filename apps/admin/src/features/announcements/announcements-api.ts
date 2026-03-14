import {
  announcementsListResponseSchema,
  announcementResponseSchema,
  announcementReportResponseSchema,
  searchResponseSchema,
  type AnnouncementSource,
  type AnnouncementStatus,
  type SearchMode,
} from "@leadfinder/contracts";
import { api } from "@/lib/api";

export interface FetchAnnouncementsParams {
  search: string;
  page: number;
  limit: number;
  source?: AnnouncementSource;
  status?: AnnouncementStatus;
}

export async function fetchAnnouncements({
  search,
  page,
  limit,
  source,
  status,
}: FetchAnnouncementsParams) {
  const response = await api.get("/announcements", {
    params: {
      page,
      limit,
      search,
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
    },
  });
  return announcementsListResponseSchema.parse(response.data);
}

export async function fetchAnnouncement(id: string) {
  const response = await api.get(`/announcements/${id}`);
  return announcementResponseSchema.parse(response.data);
}

export async function triggerScraper() {
  const response = await api.post("/scrapers/bk/trigger");
  return response.data as { jobId: string; status: string };
}

export async function triggerEzScraper() {
  const response = await api.post("/scrapers/ez/trigger");
  return response.data as { jobId: string; status: string };
}

export async function triggerPzScraper() {
  const response = await api.post("/scrapers/pz/trigger");
  return response.data as { jobId: string; status: string };
}

export async function backfillDeadlines() {
  const response = await api.post("/scrapers/bk/backfill-deadlines");
  return response.data as { updated: number };
}

export async function backfillKind() {
  const response = await api.post("/scrapers/embedding/backfill");
  return response.data as { queued: number; status: string };
}

export interface QueueStatus {
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  schedule: { name: string; cron: string; next: number }[];
  recentCompleted: {
    id: string | undefined;
    name: string;
    addedAt: string | null;
    processedAt: string | null;
    finishedAt: string | null;
    failedReason: string | null;
  }[];
  recentFailed: {
    id: string | undefined;
    name: string;
    addedAt: string | null;
    processedAt: string | null;
    finishedAt: string | null;
    failedReason: string | null;
  }[];
}

export async function fetchQueueStatus() {
  const response = await api.get("/scrapers/queue-status");
  return response.data as QueueStatus;
}

export interface AiSearchParams {
  q: string;
  mode: SearchMode;
  limit?: number;
  threshold?: number;
}

export async function searchAnnouncementsAi({
  q,
  mode,
  limit = 12,
  threshold = 0.3,
}: AiSearchParams) {
  const response = await api.get("/search", {
    params: {
      q,
      mode,
      limit,
      threshold,
    },
  });

  const result = searchResponseSchema.safeParse(response.data);
  if (!result.success) {
    console.error("[searchAnnouncementsAi] Zod validation failed — issues:");
    console.table(
      result.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
        received: (i as { received?: unknown }).received,
      })),
    );
    console.error(
      "[searchAnnouncementsAi] raw meta:",
      JSON.stringify(response.data?.meta, null, 2),
    );
    throw new Error(`Response validation failed: ${result.error.message}`);
  }
  return result.data;
}

/** Generuje (lub regeneruje) pełny raport analityczny dla ogłoszenia. */
export async function generateAnnouncementReport(id: string) {
  const response = await api.post(`/announcements/${id}/report`);
  return announcementReportResponseSchema.parse(response.data);
}

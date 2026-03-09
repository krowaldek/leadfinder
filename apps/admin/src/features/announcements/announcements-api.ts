import {
  announcementsListResponseSchema,
  announcementResponseSchema,
  type AnnouncementSource,
  type AnnouncementStatus,
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

export interface QueueStatus {
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  schedule: { name: string; cron: string; next: number }[];
  recentCompleted: { id: string | undefined; name: string; addedAt: string | null; processedAt: string | null; finishedAt: string | null; failedReason: string | null }[];
  recentFailed: { id: string | undefined; name: string; addedAt: string | null; processedAt: string | null; finishedAt: string | null; failedReason: string | null }[];
}

export async function fetchQueueStatus() {
  const response = await api.get("/scrapers/bk/queue-status");
  return response.data as QueueStatus;
}

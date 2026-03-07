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

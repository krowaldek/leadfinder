import { AnnouncementStatus, AnnouncementSource, Prisma } from "@prisma/client";

const BK_PUBLIC_BASE = "https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl";

// ---------------------------------------------------------------------------
// Raw BK API shapes (based on real API responses)
// ---------------------------------------------------------------------------

/** Item returned by /api/announcements/search */
export interface BkListItem {
  id: number;
  title: string;
  content?: string;
  advertiser_name?: string;
  publication_date?: string;
  submission_deadline?: string;
  fulfillment_place?: string;
  is_mine?: boolean;
  favorite?: null | unknown;
}

/** Envelope for search response: { status: "OK", data: { advertisements: [], meta: { total: N } } } */
export interface BkSearchResponse {
  status: string;
  data: {
    advertisements: BkListItem[];
    meta: { total: number };
  };
}

/** Pojedynczy załącznik z BK API */
export interface BkAttachment {
  id: number;
  name: string;
  file: {
    id: number;
    uri: string;   // np. "/api/files/2383677"
    name: string;
  };
}

/** Detail item inside /api/announcements/{id} */
export interface BkAnnouncementDetail {
  id: number;
  title: string;
  publication_date?: string;
  submission_deadline?: string;
  planned_sign_date?: string;
  supplementary_orders?: string;
  terms_of_contract_change?: string;
  created_at?: string;
  modified_at?: string;
  partial_offer_allowed?: boolean;
  contact_persons?: unknown[];
  attachments?: BkAttachment[];
  [key: string]: unknown;
}

/** Envelope for detail response: { status: "OK", data: { advertisement: {...} } } */
export interface BkDetailResponse {
  status: string;
  data: {
    advertisement: BkAnnouncementDetail;
  };
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

export type AnnouncementUpsertData = {
  sourceSystem: AnnouncementSource;
  externalId: string;
  title: string;
  description: string | null;
  url: string;
  status: AnnouncementStatus;
  valueMin: Prisma.Decimal | null;
  valueMax: Prisma.Decimal | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  rawData: Prisma.InputJsonValue;
};

/**
 * Maps a BK detail response to the Announcement upsert payload.
 * @param listId      – the ID from the search list (used in public URL and as externalId)
 * @param detail      – the advertisement object from /api/announcements/{listId}
 * @param listContent – optional `content` field from the search list item (human-readable description)
 */
export function mapBkDetailToUpsertData(
  listId: string,
  detail: BkAnnouncementDetail,
  listContent?: string | null,
): AnnouncementUpsertData {
  return {
    sourceSystem: AnnouncementSource.BAZA_KONKURENCYJNOSCI,
    externalId: listId,
    title: detail.title,
    description: listContent?.trim() || null,
    url: `${BK_PUBLIC_BASE}/ogloszenia/${listId}`,
    status: AnnouncementStatus.OPEN, // fetched with status[0]=PUBLISHED filter
    valueMin: null,
    valueMax: null,
    publishedAt: detail.publication_date ? new Date(detail.publication_date) : null,
    deadlineAt: detail.submission_deadline ? new Date(detail.submission_deadline) : null,
    rawData: detail as unknown as Prisma.InputJsonValue,
  };
}

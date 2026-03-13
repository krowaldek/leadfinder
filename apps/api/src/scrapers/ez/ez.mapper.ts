import { AnnouncementStatus, AnnouncementSource, Prisma } from "@prisma/client";

const EZ_PORTAL_BASE = "https://ezamowienia.gov.pl/mp-client/search/list";

// ---------------------------------------------------------------------------
// Raw ezamowienia.gov.pl API shapes
// Based on: GET /mo-board/api/v1/notice?NoticeType=ContractNotice&...
// ---------------------------------------------------------------------------

/**
 * EzNotice stripped of `htmlBody` — used throughout the scraper pipeline.
 * The htmlBody is dropped immediately after fetching each page to avoid OOM
 * when loading hundreds of pages into memory before any filtering.
 */
export type EzNoticeSummary = Omit<EzNotice, "htmlBody">;

/** Single notice item returned by the ezamowienia list endpoint */
export interface EzNotice {
  /** Stable UUID per notice revision — used as externalId */
  objectId: string;
  /** OCDS tender identifier (shared across revisions) */
  tenderId: string;
  /** Full notice number incl. revision, e.g. "2026/BZP 00153348/01" */
  noticeNumber: string;
  /** BZP number without revision, e.g. "2026/BZP 00153348" */
  bzpNumber: string;
  noticeType: string;
  /** "Works" | "Services" | "Delivery" */
  orderType: string;
  tenderType: string;
  clientType: string;
  isTenderAmountBelowEU: boolean;
  /** ISO datetime of publication */
  publicationDate: string;
  /** Order title / object */
  orderObject: string;
  /** CPV codes as comma-separated string, e.g. "45233220-7 (Roboty ...)" */
  cpvCode: string;
  /** ISO datetime — submission deadline */
  submittingOffersDate: string | null;
  procedureResult: null | unknown;
  organizationName: string;
  organizationCity: string;
  organizationProvince: string;
  organizationCountry: string;
  organizationNationalId: string;
  organizationId: string;
  /** Full HTML content of the notice */
  htmlBody: string | null;
  contractors: null | unknown;
}

// ---------------------------------------------------------------------------
// Upsert payload type (mirrors BK mapper)
// ---------------------------------------------------------------------------

export type AnnouncementUpsertData = {
  sourceSystem: AnnouncementSource;
  externalId: string;
  partIndex: number;
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

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Maps a raw ezamowienia notice (without htmlBody) to the Announcement upsert payload.
 * htmlBody is stripped at fetch time in the scraper service to prevent OOM.
 */
export function mapEzNoticeToUpsertData(notice: EzNoticeSummary): AnnouncementUpsertData {
  const rawWithoutHtml = notice;

  return {
    sourceSystem: AnnouncementSource.E_ZAMOWIENIA,
    externalId: notice.objectId,
    partIndex: 0,
    title: notice.orderObject.trim(),
    description: buildDescription(notice),
    url: `${EZ_PORTAL_BASE}/${notice.tenderId}`,
    status: AnnouncementStatus.OPEN,
    valueMin: null,
    valueMax: null,
    publishedAt: notice.publicationDate ? new Date(notice.publicationDate) : null,
    deadlineAt: notice.submittingOffersDate ? new Date(notice.submittingOffersDate) : null,
    rawData: rawWithoutHtml as unknown as Prisma.InputJsonValue,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildDescription(notice: EzNoticeSummary): string | null {
  const parts: string[] = [];

  if (notice.cpvCode?.trim()) {
    parts.push(`CPV: ${notice.cpvCode.trim()}`);
  }

  if (notice.organizationName?.trim()) {
    parts.push(`Zamawiający: ${notice.organizationName.trim()}`);
  }

  if (notice.organizationCity?.trim()) {
    parts.push(`Miejscowość: ${notice.organizationCity.trim()}`);
  }

  if (notice.orderType?.trim()) {
    parts.push(`Rodzaj: ${mapOrderType(notice.orderType)}`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

function mapOrderType(orderType: string): string {
  switch (orderType) {
    case "Works":
      return "Roboty budowlane";
    case "Services":
      return "Usługi";
    case "Delivery":
      return "Dostawy";
    default:
      return orderType;
  }
}

import { z } from "zod";
import { listQuerySchema, paginatedMetaSchema } from "./common.js";

export const announcementSourceSchema = z.enum([
  "BAZA_KONKURENCYJNOSCI",
  "E_ZAMOWIENIA",
  "PLATFORMA_ZAKUPOWA",
]);
export type AnnouncementSource = z.infer<typeof announcementSourceSchema>;

export const announcementStatusSchema = z.enum([
  "OPEN",
  "CLOSED",
  "AWARDED",
  "UNKNOWN",
]);
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;

export const announcementKindSchema = z.enum([
  "DOSTAWA",
  "USLUGA",
  "ROBOTY_BUDOWLANE",
  "SZKOLENIE",
  "USLUGA_IT",
  "USLUGA_BADAWCZO_ROZWOJOWA",
  "DORADZTWO",
  "INNE",
]);
export type AnnouncementKind = z.infer<typeof announcementKindSchema>;

export const embeddingStatusSchema = z.enum(["PENDING", "EMBEDDED", "ERROR"]);
export type EmbeddingStatus = z.infer<typeof embeddingStatusSchema>;

export const announcementSchema = z.object({
  id: z.string().uuid(),
  sourceSystem: announcementSourceSchema,
  externalId: z.string(),
  partIndex: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  status: announcementStatusSchema,
  valueMin: z.string().nullable(),
  valueMax: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  searchContext: z.string().optional(),
  kind: announcementKindSchema.nullable().optional(),
  detailedReport: z.string().nullable().optional(),
  llmEstimatedValue: z.string().nullable().optional(),
  embeddingStatus: embeddingStatusSchema.optional(),
  rawData: z.unknown(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Announcement = z.infer<typeof announcementSchema>;

export const announcementsListQuerySchema = listQuerySchema.extend({
  source: announcementSourceSchema.optional(),
  status: announcementStatusSchema.optional(),
});
export type AnnouncementsListQuery = z.infer<typeof announcementsListQuerySchema>;

export const announcementsListResponseSchema = z.object({
  data: z.array(announcementSchema),
  meta: paginatedMetaSchema,
});
export type AnnouncementsListResponse = z.infer<typeof announcementsListResponseSchema>;

export const announcementResponseSchema = z.object({
  data: announcementSchema,
});
export type AnnouncementResponse = z.infer<typeof announcementResponseSchema>;

export const announcementReportResponseSchema = z.object({
  data: z.object({
    detailedReport: z.string(),
  }),
});
export type AnnouncementReportResponse = z.infer<typeof announcementReportResponseSchema>;

import { z } from "zod";
import { listQuerySchema, paginatedMetaSchema } from "./common.js";

export const announcementSourceSchema = z.enum([
  "BAZA_KONKURENCYJNOSCI",
  "E_ZAMOWIENIA",
  "PLATFORMA_ZAKUPOWA",
  "INTERNAL",
]);
export type AnnouncementSource = z.infer<typeof announcementSourceSchema>;

export const internalAnnouncementPromptRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().trim().min(1).max(4000),
});
export type InternalAnnouncementPromptRequest = z.infer<
  typeof internalAnnouncementPromptRequestSchema
>;

export const internalAnnouncementChatListQuerySchema = listQuerySchema;
export type InternalAnnouncementChatListQuery = z.infer<
  typeof internalAnnouncementChatListQuerySchema
>;

export const internalAnnouncementChatCommentRequestSchema = z.object({
  content: z.string().trim().min(1).max(3000),
});
export type InternalAnnouncementChatCommentRequest = z.infer<
  typeof internalAnnouncementChatCommentRequestSchema
>;

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
  aiTitle: z.string().nullable().optional(),
  displayTitle: z.string().optional(),
  description: z.string().nullable(),
  url: z.string(),
  status: announcementStatusSchema,
  valueMin: z.string().nullable(),
  valueMax: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  location: z.string().nullable().optional(),
  contractingAuthority: z.string().nullable().optional(),
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

export const internalAnnouncementPromptQuestionResponseSchema = z.object({
  status: z.literal("question"),
  sessionId: z.string(),
  question: z.string(),
  collectedData: z.record(z.string(), z.unknown()),
});

export const internalAnnouncementPromptReviewResponseSchema = z.object({
  status: z.literal("review"),
  sessionId: z.string(),
  summary: z.string(),
  collectedData: z.record(z.string(), z.unknown()),
});

export const internalAnnouncementPromptCreatedResponseSchema = z.object({
  status: z.literal("created"),
  announcement: z.lazy(() => announcementSchema),
});

export const internalAnnouncementChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type InternalAnnouncementChatMessage = z.infer<typeof internalAnnouncementChatMessageSchema>;

export const internalAnnouncementChatCommentSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  authorName: z.string().nullable().optional(),
  authorEmail: z.string().nullable().optional(),
});
export type InternalAnnouncementChatComment = z.infer<typeof internalAnnouncementChatCommentSchema>;

export const internalAnnouncementChatListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  lastMessagePreview: z.string().nullable(),
});
export type InternalAnnouncementChatListItem = z.infer<typeof internalAnnouncementChatListItemSchema>;

export const internalAnnouncementChatDetailSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  detailedReport: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  collectedData: z.record(z.string(), z.unknown()),
  conversation: z.array(internalAnnouncementChatMessageSchema),
  feedbackComments: z.array(internalAnnouncementChatCommentSchema),
});
export type InternalAnnouncementChatDetail = z.infer<typeof internalAnnouncementChatDetailSchema>;

export const internalAnnouncementPromptResponseSchema = z.discriminatedUnion("status", [
  internalAnnouncementPromptQuestionResponseSchema,
  internalAnnouncementPromptReviewResponseSchema,
  internalAnnouncementPromptCreatedResponseSchema,
]);
export type InternalAnnouncementPromptResponse = z.infer<
  typeof internalAnnouncementPromptResponseSchema
>;

export const internalAnnouncementChatListResponseSchema = z.object({
  data: z.array(internalAnnouncementChatListItemSchema),
  meta: paginatedMetaSchema,
});
export type InternalAnnouncementChatListResponse = z.infer<
  typeof internalAnnouncementChatListResponseSchema
>;

export const internalAnnouncementChatDetailResponseSchema = z.object({
  data: internalAnnouncementChatDetailSchema,
});
export type InternalAnnouncementChatDetailResponse = z.infer<
  typeof internalAnnouncementChatDetailResponseSchema
>;

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

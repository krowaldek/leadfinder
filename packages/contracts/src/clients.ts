import { z } from "zod";

export const geographicScopeSchema = z.enum(["NATIONAL", "REGIONAL", "LOCAL"]);
export type GeographicScope = z.infer<typeof geographicScopeSchema>;

export const clientStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

export const clientMatchStatusSchema = z.enum([
  "NEW",
  "VIEWED",
  "DISMISSED",
  "SHORTLISTED",
]);
export type ClientMatchStatus = z.infer<typeof clientMatchStatusSchema>;

export const clientProfileFieldsSchema = z.object({
  companyName: z.string().trim().min(1),
  industry: z.string().trim().min(1),
  geographicScope: geographicScopeSchema,
  geographicDetails: z.string().trim().optional(),
  budgetDescription: z.string().trim().min(1),
  contactPersonName: z.string().trim().min(1),
  contactPersonRole: z.string().trim().min(1),
});
export type ClientProfileFields = z.infer<typeof clientProfileFieldsSchema>;

export const updateClientSchema = z.object({
  companyName: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1).optional(),
  geographicScope: geographicScopeSchema.optional(),
  geographicDetails: z.string().trim().nullable().optional(),
  budgetDescription: z.string().trim().min(1).optional(),
  contactPersonName: z.string().trim().min(1).optional(),
  contactPersonRole: z.string().trim().min(1).optional(),
  negativeKeywords: z.array(z.string().trim().min(1)).optional(),
});
export type UpdateClient = z.infer<typeof updateClientSchema>;

export const promptRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().trim().min(1).max(2000),
});
export type PromptRequest = z.infer<typeof promptRequestSchema>;

export const clientResponseSchema = z.object({
  id: z.string(),
  companyName: z.string(),
  industry: z.string(),
  geographicScope: geographicScopeSchema,
  geographicDetails: z.string().nullable(),
  budgetDescription: z.string(),
  contactPersonName: z.string(),
  contactPersonRole: z.string(),
  profileSummary: z.string(),
  negativeKeywords: z.array(z.string()),
  status: clientStatusSchema,
  matchCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientResponse = z.infer<typeof clientResponseSchema>;

export const clientMatchAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  sourceSystem: z.string(),
  externalId: z.string(),
  publishedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  valueMin: z.string().nullable(),
  valueMax: z.string().nullable(),
});

export const clientMatchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  price: z.string().nullable(),
  kind: z.string().nullable().optional(),
  shortSummary: z.string().nullable().optional(),
  llmEstimatedValue: z.string().nullable().optional(),
  searchContext: z.string().optional(),
  announcement: clientMatchAnnouncementSchema,
});

export const clientMatchResponseSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  announcementItemId: z.string(),
  similarity: z.number(),
  status: clientMatchStatusSchema,
  announcementItem: clientMatchItemSchema,
  createdAt: z.string(),
});
export type ClientMatchResponse = z.infer<typeof clientMatchResponseSchema>;

export const promptQuestionResponseSchema = z.object({
  status: z.literal("question"),
  sessionId: z.string(),
  question: z.string(),
  collectedData: z.record(z.string(), z.unknown()),
});

export const promptCreatedResponseSchema = z.object({
  status: z.literal("created"),
  client: clientResponseSchema,
  matchCount: z.number(),
});

export const promptResponseSchema = z.discriminatedUnion("status", [
  promptQuestionResponseSchema,
  promptCreatedResponseSchema,
]);
export type PromptResponse = z.infer<typeof promptResponseSchema>;

export const clientsListResponseSchema = z.object({
  data: z.array(clientResponseSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  }),
});
export type ClientsListResponse = z.infer<typeof clientsListResponseSchema>;

export const clientMatchesResponseSchema = z.object({
  clientProfileSummary: z.string().optional(),
  data: z.array(clientMatchResponseSchema),
  meta: z.object({
    total: z.number(),
  }),
});
export type ClientMatchesResponse = z.infer<typeof clientMatchesResponseSchema>;

export const updateMatchStatusSchema = z.object({
  status: clientMatchStatusSchema,
});
export type UpdateMatchStatus = z.infer<typeof updateMatchStatusSchema>;

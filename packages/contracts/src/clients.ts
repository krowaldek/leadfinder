import { z } from "zod";
import { searchModeSchema } from "./search.js";

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
  status: clientStatusSchema,
  projectCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientResponse = z.infer<typeof clientResponseSchema>;

/// Flat announcement shape used inside match responses.
export const clientMatchAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  url: z.string(),
  sourceSystem: z.string(),
  externalId: z.string(),
  partIndex: z.number(),
  publishedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  valueMin: z.string().nullable(),
  valueMax: z.string().nullable(),
  kind: z.string().nullable().optional(),
  searchContext: z.string().optional(),
  detailedReport: z.string().nullable().optional(),
  llmEstimatedValue: z.string().nullable().optional(),
});

export const clientMatchResponseSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  announcementId: z.string(),
  similarity: z.number(),
  status: clientMatchStatusSchema,
  topic: z.object({
    id: z.string(),
    title: z.string(),
    projectId: z.string(),
    projectName: z.string(),
  }),
  announcement: clientMatchAnnouncementSchema,
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

export const onboardRequestSchema = z.object({
  activity: z.string().trim().min(5).max(2000),
  email: z.string().email().trim().toLowerCase(),
});
export type OnboardRequest = z.infer<typeof onboardRequestSchema>;

export const onboardResponseSchema = z.object({
  client: clientResponseSchema,
  projectId: z.string(),
  topicId: z.string(),
});
export type OnboardResponse = z.infer<typeof onboardResponseSchema>;

export const rematchClientRequestSchema = z.object({});
export type RematchClientRequest = z.infer<typeof rematchClientRequestSchema>;

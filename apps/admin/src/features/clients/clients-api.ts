import { z } from "zod";
import { api } from "@/lib/api";
import {
  clientsListResponseSchema,
  clientMatchesResponseSchema,
  promptResponseSchema,
  updateMatchStatusSchema,
  clientResponseSchema,
  type ClientMatchStatus,
  type UpdateClient,
} from "@leadfinder/contracts";
import {
  projectsListResponseSchema,
  projectResponseSchema,
  topicsListResponseSchema,
  topicResponseSchema,
  type CreateProject,
  type UpdateProject,
  type CreateTopic,
  type TopicMatchingProfile,
  type UpdateTopic,
} from "@leadfinder/contracts";

const topicMatchingDebugSummarySchema = z.object({
  storedMatches: z.number(),
  vectorCandidates: z.number(),
  rerankCandidates: z.number(),
  reranked: z.number(),
  shortlisted: z.number(),
  dismissed: z.number(),
});

const topicMatchingDebugRawVectorHitSchema = z.object({
  announcementId: z.string(),
  title: z.string(),
  semantic: z.number().nullable().optional(),
  keyword: z.number().nullable().optional(),
  domain: z.number().nullable().optional(),
  hybrid: z.number().nullable().optional(),
  rerank: z.number().nullable().optional(),
  final: z.number().nullable().optional(),
  stage: z.enum(["VECTOR", "MERGED", "PRE_RERANK", "RERANKED", "FINAL"]).optional(),
  keptAfterFilters: z.boolean().optional(),
  sentToRerank: z.boolean().optional(),
  keptAfterRerank: z.boolean().optional(),
  negativePenaltyApplied: z.boolean().optional(),
  rejectionReasons: z.array(z.string()).default([]),
  announcementVectorText: z.string().nullable().optional(),
  rerankReason: z.string().nullable().optional(),
  mustHaveSatisfied: z.boolean().nullable().optional(),
  excludeTriggered: z.boolean().nullable().optional(),
  kindFit: z.boolean().nullable().optional(),
  topicCentrality: z.enum(["PRIMARY", "SIGNIFICANT", "SECONDARY", "INCIDENTAL"]).nullable().optional(),
  scopeType: z.enum(["FOCUSED", "MIXED", "BUNDLED"]).nullable().optional(),
});

const topicMatchingDebugCandidateSchema = z.object({
  announcementId: z.string(),
  title: z.string(),
  semantic: z.number().nullable().optional(),
  keyword: z.number().nullable().optional(),
  domain: z.number().nullable().optional(),
  hybrid: z.number().nullable().optional(),
  rerank: z.number().nullable().optional(),
  final: z.number().nullable().optional(),
  stage: z.enum(["VECTOR", "MERGED", "PRE_RERANK", "RERANKED", "FINAL"]).optional(),
  negativePenaltyApplied: z.boolean().optional(),
  keptAfterFilters: z.boolean().optional(),
  sentToRerank: z.boolean().optional(),
  keptAfterRerank: z.boolean().optional(),
  rejectionReasons: z.array(z.string()).default([]),
  announcementVectorText: z.string().nullable().optional(),
  rerankReason: z.string().nullable().optional(),
  mustHaveSatisfied: z.boolean().nullable().optional(),
  excludeTriggered: z.boolean().nullable().optional(),
  kindFit: z.boolean().nullable().optional(),
  topicCentrality: z.enum(["PRIMARY", "SIGNIFICANT", "SECONDARY", "INCIDENTAL"]).nullable().optional(),
  scopeType: z.enum(["FOCUSED", "MIXED", "BUNDLED"]).nullable().optional(),
});

const topicMatchingDebugTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  vectorText: z.string().optional(),
  matchingProfile: topicResponseSchema.shape.data.shape.matchingProfile.optional(),
  embeddingStatus: topicResponseSchema.shape.data.shape.embeddingStatus.optional(),
  negativeKeywords: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  matchCount: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  project: z.object({
    id: z.string(),
    name: z.string(),
  }).optional(),
  client: z.object({
    id: z.string(),
    companyName: z.string(),
  }).optional(),
});

const topicMatchingDebugFinalMatchSchema = z.object({
  id: z.string(),
  status: z.string(),
  similarity: z.number().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  debug: z.unknown().optional(),
  announcement: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    url: z.string().optional(),
    sourceSystem: z.string().optional(),
    externalId: z.string().optional(),
    partIndex: z.number().optional(),
    kind: z.string().nullable().optional(),
    searchContext: z.string().optional(),
    detailedReport: z.string().nullable().optional(),
    llmEstimatedValue: z.string().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    deadlineAt: z.string().nullable().optional(),
    valueMin: z.string().nullable().optional(),
    valueMax: z.string().nullable().optional(),
  }),
});

const topicMatchingDebugReportSchema = z.object({
  data: z.object({
    topic: topicMatchingDebugTopicSchema,
    summary: topicMatchingDebugSummarySchema,
    rawVectorHits: z.array(topicMatchingDebugRawVectorHitSchema).default([]).optional(),
    vectorCandidates: z.array(topicMatchingDebugCandidateSchema),
    finalMatches: z.array(topicMatchingDebugFinalMatchSchema).default([]),
  }),
});

export type TopicMatchingDebugSummary = z.infer<typeof topicMatchingDebugSummarySchema>;
export type TopicMatchingDebugRawVectorHit = z.infer<typeof topicMatchingDebugRawVectorHitSchema>;
export type TopicMatchingDebugCandidate = z.infer<typeof topicMatchingDebugCandidateSchema>;
export type TopicMatchingDebugFinalMatch = z.infer<typeof topicMatchingDebugFinalMatchSchema>;
export type TopicMatchingDebugReport = z.infer<typeof topicMatchingDebugReportSchema>;

export async function fetchClients(page = 1, limit = 20) {
  const response = await api.get("/clients", { params: { page, limit } });
  return clientsListResponseSchema.parse(response.data);
}

export async function fetchClient(clientId: string) {
  const response = await api.get(`/clients/${clientId}`);
  return clientResponseSchema.parse(response.data.data);
}

export async function fetchClientMatches(clientId: string) {
  const response = await api.get(`/clients/${clientId}/matches`);
  return clientMatchesResponseSchema.parse(response.data);
}

export async function sendPromptMessage(
  sessionId: string | undefined,
  message: string,
) {
  const response = await api.post("/clients/prompt", { sessionId, message });
  return promptResponseSchema.parse(response.data);
}

export async function rematchClient(clientId: string) {
  const response = await api.post(`/clients/${clientId}/rematch`, {});
  return response.data as {
    clientId: string;
    message: string;
    matchingQueued: boolean;
    topicEmbeddingsQueued: number;
    embeddedTopics: number;
    pendingTopics: number;
  };
}

export async function updateClient(clientId: string, data: UpdateClient) {
  const response = await api.patch(`/clients/${clientId}`, data);
  return clientResponseSchema.parse(response.data.data);
}

export async function updateMatchStatus(
  clientId: string,
  matchId: string,
  status: ClientMatchStatus,
) {
  const payload = updateMatchStatusSchema.parse({ status });
  const response = await api.patch(
    `/clients/${clientId}/matches/${matchId}/status`,
    payload,
  );
  return response.data;
}

// Projects

export async function fetchProjects(clientId: string) {
  const response = await api.get(`/clients/${clientId}/projects`);
  return projectsListResponseSchema.parse(response.data);
}

export async function createProject(clientId: string, data: CreateProject) {
  const response = await api.post(`/clients/${clientId}/projects`, data);
  return projectResponseSchema.parse(response.data);
}

export async function updateProject(clientId: string, projectId: string, data: UpdateProject) {
  const response = await api.patch(`/clients/${clientId}/projects/${projectId}`, data);
  return projectResponseSchema.parse(response.data);
}

export async function deleteProject(clientId: string, projectId: string) {
  await api.delete(`/clients/${clientId}/projects/${projectId}`);
}

// Topics

export async function fetchTopics(clientId: string, projectId: string) {
  const response = await api.get(`/clients/${clientId}/projects/${projectId}/topics`);
  return topicsListResponseSchema.parse(response.data);
}

export async function createTopic(clientId: string, projectId: string, data: CreateTopic) {
  const response = await api.post(`/clients/${clientId}/projects/${projectId}/topics`, data);
  return topicResponseSchema.parse(response.data);
}

export async function updateTopic(clientId: string, projectId: string, topicId: string, data: UpdateTopic) {
  const response = await api.patch(`/clients/${clientId}/projects/${projectId}/topics/${topicId}`, data);
  return topicResponseSchema.parse(response.data);
}

export async function deleteTopic(clientId: string, projectId: string, topicId: string) {
  await api.delete(`/clients/${clientId}/projects/${projectId}/topics/${topicId}`);
}

export async function embedTopic(clientId: string, projectId: string, topicId: string) {
  const response = await api.post(
    `/clients/${clientId}/projects/${projectId}/topics/${topicId}/embed`,
    {},
  );
  return response.data as { message: string; topicId: string };
}

export async function generateTopicPrompt(clientId: string, title: string) {
  const response = await api.post(`/clients/${clientId}/generate-topic-prompt`, { title });
  return response.data as { prompt: string; matchingProfile: TopicMatchingProfile };
}

export async function fetchTopicMatchingDebug(
  clientId: string,
  projectId: string,
  topicId: string,
) {
  const response = await api.get(
    `/clients/${clientId}/projects/${projectId}/topics/${topicId}/matching-debug`,
  );
  return topicMatchingDebugReportSchema.parse(response.data);
}

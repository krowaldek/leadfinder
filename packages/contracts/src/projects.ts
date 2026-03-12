import { z } from "zod";
import { embeddingStatusSchema } from "./announcements.js";

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

export const topicSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  prompt: z.string(),
  embeddingStatus: embeddingStatusSchema,
  negativeKeywords: z.array(z.string()),
  matchCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Topic = z.infer<typeof topicSchema>;

export const createTopicSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(10).max(4_000),
  negativeKeywords: z.array(z.string().trim().min(1).max(100)).default([]),
});
export type CreateTopic = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = createTopicSchema.partial();
export type UpdateTopic = z.infer<typeof updateTopicSchema>;

export const topicResponseSchema = z.object({
  data: topicSchema,
});
export type TopicResponse = z.infer<typeof topicResponseSchema>;

export const topicsListResponseSchema = z.object({
  data: z.array(topicSchema),
});
export type TopicsListResponse = z.infer<typeof topicsListResponseSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  topicCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectListItem = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProject = z.infer<typeof updateProjectSchema>;

export const projectResponseSchema = z.object({
  data: projectSchema,
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectsListResponseSchema = z.object({
  data: z.array(projectSchema),
});
export type ProjectsListResponse = z.infer<typeof projectsListResponseSchema>;

// ---------------------------------------------------------------------------
// Global list shapes (with client context)
// ---------------------------------------------------------------------------

export const projectWithClientSchema = projectSchema.extend({
  clientName: z.string(),
});
export type ProjectWithClient = z.infer<typeof projectWithClientSchema>;

export const projectsGlobalListResponseSchema = z.object({
  data: z.array(projectWithClientSchema),
  meta: z.object({ total: z.number(), page: z.number(), limit: z.number(), totalPages: z.number() }),
});
export type ProjectsGlobalListResponse = z.infer<typeof projectsGlobalListResponseSchema>;

export const topicWithContextSchema = topicSchema.extend({
  projectName: z.string(),
  clientId: z.string(),
  clientName: z.string(),
});
export type TopicWithContext = z.infer<typeof topicWithContextSchema>;

export const topicsGlobalListResponseSchema = z.object({
  data: z.array(topicWithContextSchema),
  meta: z.object({ total: z.number(), page: z.number(), limit: z.number(), totalPages: z.number() }),
});
export type TopicsGlobalListResponse = z.infer<typeof topicsGlobalListResponseSchema>;

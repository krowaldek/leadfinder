import { z } from "zod";
import { embeddingStatusSchema } from "./announcements.js";
import { announcementKindSchema } from "./announcements.js";

const PROFILE_START_MARKER = "[[LEADFINDER_TOPIC_PROFILE]]";
const PROFILE_END_MARKER = "[[/LEADFINDER_TOPIC_PROFILE]]";

const topicTermSchema = z.string().trim().min(2).max(100);

function normalizeTerms(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export const topicMatchingProfileSchema = z.object({
  summary: z.string().trim().min(10).max(4_000),
  mustHave: z.array(topicTermSchema).max(12).default([]),
  niceToHave: z.array(topicTermSchema).max(12).default([]),
  exclude: z.array(topicTermSchema).max(12).default([]),
  expectedKinds: z.array(announcementKindSchema).max(4).default([]),
}).transform((profile) => ({
  summary: profile.summary.trim(),
  mustHave: normalizeTerms(profile.mustHave),
  niceToHave: normalizeTerms(profile.niceToHave),
  exclude: normalizeTerms(profile.exclude),
  expectedKinds: [...new Set(profile.expectedKinds)],
}));
export type TopicMatchingProfile = z.infer<typeof topicMatchingProfileSchema>;

function parsePipeSeparatedTerms(value: string): string[] {
  return normalizeTerms(
    value
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function buildTopicPromptFromProfile(profileInput: TopicMatchingProfile): string {
  const profile = topicMatchingProfileSchema.parse(profileInput);
  const lines = [
    PROFILE_START_MARKER,
    `SUMMARY: ${profile.summary}`,
    `MUST_HAVE: ${profile.mustHave.join(" | ")}`,
    `NICE_TO_HAVE: ${profile.niceToHave.join(" | ")}`,
    `EXCLUDE: ${profile.exclude.join(" | ")}`,
    `EXPECTED_KINDS: ${profile.expectedKinds.join(" | ")}`,
    PROFILE_END_MARKER,
    "",
    profile.summary,
  ];

  if (profile.mustHave.length > 0) {
    lines.push("", `Kluczowe wymagania: ${profile.mustHave.join(", ")}.`);
  }

  if (profile.niceToHave.length > 0) {
    lines.push(`Dodatkowe mile widziane elementy: ${profile.niceToHave.join(", ")}.`);
  }

  if (profile.exclude.length > 0) {
    lines.push(`Wyklucz: ${profile.exclude.join(", ")}.`);
  }

  if (profile.expectedKinds.length > 0) {
    lines.push(`Preferowane typy zamówień: ${profile.expectedKinds.join(", ")}.`);
  }

  return lines.join("\n").trim();
}

export function parseTopicMatchingProfile(
  prompt: string,
  negativeKeywords: string[] = [],
): TopicMatchingProfile | null {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return null;

  const start = trimmedPrompt.indexOf(PROFILE_START_MARKER);
  const end = trimmedPrompt.indexOf(PROFILE_END_MARKER);

  if (start < 0 || end < start) {
    return topicMatchingProfileSchema.parse({
      summary: trimmedPrompt,
      mustHave: [],
      niceToHave: [],
      exclude: negativeKeywords,
      expectedKinds: [],
    });
  }

  const block = trimmedPrompt
    .slice(start + PROFILE_START_MARKER.length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const values = new Map<string, string>();
  for (const line of block) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  const fallbackSummary = trimmedPrompt.slice(end + PROFILE_END_MARKER.length).trim();

  return topicMatchingProfileSchema.parse({
    summary: values.get("SUMMARY") || fallbackSummary || trimmedPrompt,
    mustHave: parsePipeSeparatedTerms(values.get("MUST_HAVE") ?? ""),
    niceToHave: parsePipeSeparatedTerms(values.get("NICE_TO_HAVE") ?? ""),
    exclude: normalizeTerms([
      ...parsePipeSeparatedTerms(values.get("EXCLUDE") ?? ""),
      ...negativeKeywords,
    ]),
    expectedKinds: parsePipeSeparatedTerms(values.get("EXPECTED_KINDS") ?? ""),
  });
}

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

export const topicSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  prompt: z.string(),
  matchingProfile: topicMatchingProfileSchema.optional(),
  embeddingStatus: embeddingStatusSchema,
  negativeKeywords: z.array(z.string()),
  matchCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Topic = z.infer<typeof topicSchema>;

const topicInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().max(4_000).default(""),
  matchingProfile: topicMatchingProfileSchema.optional(),
  negativeKeywords: z.array(z.string().trim().min(1).max(100)).default([]),
});

export const createTopicSchema = topicInputSchema.superRefine((value, ctx) => {
  const prompt = value.prompt.trim();
  const summary = value.matchingProfile?.summary.trim() ?? "";
  if (!prompt && !summary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prompt"],
      message: "Podaj opis wyszukiwania albo uzupełnij profil dopasowania.",
    });
  }

  if (!summary && prompt && prompt.length < 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prompt"],
      message: "Opis wyszukiwania musi mieć co najmniej 10 znaków.",
    });
  }
});
export type CreateTopic = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = topicInputSchema.partial().superRefine((value, ctx) => {
  if (value.prompt === undefined && value.matchingProfile === undefined) {
    return;
  }

  const prompt = value.prompt?.trim() ?? "";
  const summary = value.matchingProfile?.summary.trim() ?? "";

  if (!prompt && !summary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prompt"],
      message: "Podaj opis wyszukiwania albo uzupełnij profil dopasowania.",
    });
  }

  if (!summary && value.prompt !== undefined && prompt && prompt.length < 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prompt"],
      message: "Opis wyszukiwania musi mieć co najmniej 10 znaków.",
    });
  }
});
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

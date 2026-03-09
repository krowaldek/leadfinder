import { z } from "zod";

export const searchModeSchema = z.enum([
  "VECTOR",
  "HYBRID",
  "RERANK",
  "QUERY_EXPANSION",
  "LEARNING_TO_RANK",
  "MULTI_STAGE",
  "DOMAIN_AWARE",
  "MULTI_VECTOR",
  "DIVERSIFIED",
]);
export type SearchMode = z.infer<typeof searchModeSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  mode: searchModeSchema.default("HYBRID"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.3),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const scoreBreakdownSchema = z.object({
  semantic: z.number().nullable(),
  keyword: z.number().nullable(),
  domain: z.number().nullable(),
  rerank: z.number().nullable(),
  feedback: z.number().nullable(),
  diversity: z.number().nullable(),
});

export const searchResultItemSchema = z.object({
  id: z.string(),
  announcementId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  price: z.unknown().nullable(),
  source: z.string(),
  externalId: z.string(),
  announcementTitle: z.string(),
  valueMin: z.unknown().nullable(),
  valueMax: z.unknown().nullable(),
  similarity: z.number(),
  score: z.number(),
  mode: searchModeSchema,
  scores: scoreBreakdownSchema,
  explanations: z.array(z.string()),
  publishedAt: z.string().nullable(),
  url: z.string(),
});

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResponseSchema = z.object({
  data: z.array(searchResultItemSchema),
  meta: z.object({
    query: z.string(),
    effectiveQuery: z.string(),
    mode: searchModeSchema,
    limit: z.number(),
    count: z.number(),
    threshold: z.number(),
    generatedAt: z.string(),
  }),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

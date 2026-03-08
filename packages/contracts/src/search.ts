import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.3),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

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
  publishedAt: z.string().nullable(),
  url: z.string(),
});

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResponseSchema = z.object({
  data: z.array(searchResultItemSchema),
  meta: z.object({
    query: z.string(),
    limit: z.number(),
    count: z.number(),
    threshold: z.number(),
  }),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

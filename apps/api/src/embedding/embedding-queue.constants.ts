export const EMBEDDING_QUEUE = "embedding";

export const EMBEDDING_JOB_PRIORITY = {
  TOPIC: 1,
  ANNOUNCEMENT: 10,
} as const;

export const EmbeddingJob = {
  /** Analyse, report, and embed a flat Announcement record. */
  EMBED_ANNOUNCEMENT: "announcement.embed",
  /** Embed a Topic's prompt for client matching. */
  EMBED_TOPIC: "topic.embed",
} as const;

export type EmbeddingJobName = (typeof EmbeddingJob)[keyof typeof EmbeddingJob];

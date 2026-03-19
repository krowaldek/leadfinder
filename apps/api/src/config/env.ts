import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().min(2).default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  API_PORT: z.coerce.number().int().positive().default(3001),
  ADMIN_EMAIL: z.email().default("admin@leadfinder.local"),
  ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  BK_API_BASE_URL: z.string().url().optional(),
  EZ_API_BASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  BK_SCRAPER_CRON: z.string().default("0 6 * * *"),
  PZ_SCRAPER_CRON: z.string().default("5 * * * *"),
  EMBEDDING_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(6),
  EMBEDDING_PROVIDER: z.enum(["OPENAI", "GOOGLE"]).default("OPENAI"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-5.4-nano"),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_EMBEDDING_MODEL: z.string().default("gemini-embedding-2-preview"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}

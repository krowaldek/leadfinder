import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobLogType = "SCRAPER" | "EMBEDDING" | "REPORT";
export type JobLogStatus = "STARTED" | "COMPLETED" | "FAILED";

export interface JobLog {
  id: string;
  type: JobLogType;
  jobId: string | null;
  jobName: string;
  status: JobLogStatus;
  entityId: string | null;
  entityTitle: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
}

export interface LogsMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LogsResponse {
  data: JobLog[];
  meta: LogsMeta;
}

export interface TypeStats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  lastRunAt: string | null;
  avgDurationMs: number | null;
}

export interface LogsStats {
  scraper: TypeStats;
  embedding: TypeStats;
  report: TypeStats;
}

export interface ReembedSourceProgress {
  sourceSystem: string;
  totalItems: number;
  embeddedItems: number;
  itemsWithReport: number;
  reportReadyItems: number;
  embeddedWithReport: number;
  legacyEmbeddedItems: number;
  pendingItems: number;
  errorItems: number;
  reembedCoverage: number;
}

export interface ReembedProgress {
  summary: Omit<ReembedSourceProgress, "sourceSystem">;
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  bySource: ReembedSourceProgress[];
}

// ── API calls ──────────────────────────────────────────────────────────────────

async function fetchLogs(
  type: "scraper" | "embedding" | "reports",
  params: { page?: number; limit?: number; status?: JobLogStatus; jobName?: string },
): Promise<LogsResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.status) query.set("status", params.status);
  if (params.jobName) query.set("jobName", params.jobName);
  const res = await api.get<LogsResponse>(`/logs/${type}?${query}`);
  return res.data;
}

async function fetchStats(): Promise<LogsStats> {
  const res = await api.get<LogsStats>("/logs/stats");
  return res.data;
}

async function fetchReembedProgress(): Promise<ReembedProgress> {
  const res = await api.get<ReembedProgress>("/logs/reembed-progress");
  return res.data;
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

export interface UseLogsOptions {
  page?: number;
  limit?: number;
  status?: JobLogStatus;
  jobName?: string;
  refetchInterval?: number;
}

export function useScraperLogs(opts: UseLogsOptions = {}) {
  const { page = 1, limit = 50, status, jobName, refetchInterval = 10_000 } = opts;
  return useQuery<LogsResponse>({
    queryKey: ["logs", "scraper", { page, limit, status, jobName }],
    queryFn: () => fetchLogs("scraper", { page, limit, status, jobName }),
    refetchInterval,
  });
}

export function useEmbeddingLogs(opts: UseLogsOptions = {}) {
  const { page = 1, limit = 50, status, refetchInterval = 10_000 } = opts;
  return useQuery<LogsResponse>({
    queryKey: ["logs", "embedding", { page, limit, status }],
    queryFn: () => fetchLogs("embedding", { page, limit, status }),
    refetchInterval,
  });
}

export function useReportLogs(opts: UseLogsOptions = {}) {
  const { page = 1, limit = 50, status, refetchInterval = 10_000 } = opts;
  return useQuery<LogsResponse>({
    queryKey: ["logs", "reports", { page, limit, status }],
    queryFn: () => fetchLogs("reports", { page, limit, status }),
    refetchInterval,
  });
}

export function useLogsStats(refetchInterval = 15_000) {
  return useQuery<LogsStats>({
    queryKey: ["logs", "stats"],
    queryFn: fetchStats,
    refetchInterval,
  });
}

export function useReembedProgress(refetchInterval = 15_000) {
  return useQuery<ReembedProgress>({
    queryKey: ["logs", "reembed-progress"],
    queryFn: fetchReembedProgress,
    refetchInterval,
  });
}

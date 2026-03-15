import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  AlertCircle,
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  FolderKanban,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Tags,
  Users,
  Zap,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import type { LogsStats, ReembedProgress } from "@/features/logs/logs-api";
import { OnboardingDialog } from "@/components/OnboardingDialog";

interface TokenTypeStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  jobsWithTokens: number;
}

interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  jobsWithTokens: number;
  byType: Record<string, TokenTypeStats>;
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchDashboardData() {
  const [
    announcementsRes,
    clientsRes,
    statsRes,
    progressRes,
    queueRes,
    tokenRes,
    projectsRes,
    topicsRes,
  ] = await Promise.all([
    api.get<{ meta: { total: number } }>("/announcements?limit=1"),
    api.get<{ meta: { total: number } }>("/clients?limit=1"),
    api.get<LogsStats>("/logs/stats"),
    api.get<ReembedProgress>("/logs/reembed-progress"),
    api.get("/scrapers/queue-status"),
    api.get<TokenStats>("/logs/token-stats").catch(() => ({ data: null })),
    api
      .get<{ meta: { total: number } }>("/clients/all-projects?limit=1")
      .catch(() => ({ data: { meta: { total: 0 } } })),
    api
      .get<{ meta: { total: number } }>("/clients/all-topics?limit=1")
      .catch(() => ({ data: { meta: { total: 0 } } })),
  ]);

  return {
    announcementsTotal: announcementsRes.data.meta.total,
    clientsTotal: clientsRes.data.meta.total,
    projectsTotal: projectsRes.data.meta.total,
    topicsTotal: topicsRes.data.meta.total,
    stats: statsRes.data,
    progress: progressRes.data,
    scraperQueue: queueRes.data as {
      counts: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
      };
      schedule: { name: string; cron: string; next: number }[];
      recentCompleted: { id: string; name: string; finishedAt: string }[];
    },
    tokenStats: tokenRes.data as TokenStats | null,
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("pl-PL");
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return format(new Date(iso), "dd.MM.yyyy HH:mm", { locale: pl });
}

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return null;
  return formatDistanceToNow(new Date(iso), { locale: pl, addSuffix: true });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-foreground",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>
              {typeof value === "number" ? fmt(value) : value}
            </p>
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="rounded-lg bg-muted p-2">
            <Icon className="size-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function JobTypeRow({
  label,
  stats,
}: {
  label: string;
  stats: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    lastRunAt: string | null;
    avgDurationMs: number | null;
  };
}) {
  const successRate =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : null;
  const isRunning = stats.running > 0;

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="size-3.5 animate-spin text-blue-500" />
          ) : stats.failed > 0 && stats.completed === 0 ? (
            <AlertCircle className="size-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-3.5 text-green-500" />
          )}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {stats.lastRunAt && (
            <span className="hidden sm:inline">{fmtAgo(stats.lastRunAt)}</span>
          )}
          <Badge variant="outline" className="tabular-nums">
            {fmt(stats.total)} jobów
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="size-3 text-green-500" />
          {fmt(stats.completed)} ukończone
        </span>
        <span className="flex items-center gap-1">
          <AlertCircle className="size-3 text-destructive" />
          {fmt(stats.failed)} błędy
        </span>
        {stats.running > 0 && (
          <span className="flex items-center gap-1">
            <Activity className="size-3 text-blue-500" />
            {stats.running} aktywne
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          śr. {fmtDuration(stats.avgDurationMs)}
        </span>
        {successRate !== null && (
          <span className="ml-auto font-medium text-foreground">
            {successRate}% sukces
          </span>
        )}
      </div>
    </div>
  );
}

// ── Model config card ─────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const ANALYSIS_MODEL = "gpt-5-mini";
const EMBEDDING_DIM = 1536;
const EMBEDDING_COST_PER_1M = 0.02; // USD
const ANALYSIS_COST_PER_1M_IN = 0.15;
const ANALYSIS_COST_PER_1M_OUT = 0.6;

function ModelsCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4" />
          Modele AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Embeddingi</span>
            </div>
            <Badge variant="secondary" className="font-mono text-xs">
              {EMBEDDING_MODEL}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Wymiarowość</dt>
            <dd className="font-mono">{EMBEDDING_DIM}</dd>
            <dt className="text-muted-foreground">Koszt</dt>
            <dd className="font-mono">${EMBEDDING_COST_PER_1M}/1M tokenów</dd>
            <dt className="text-muted-foreground">Provider</dt>
            <dd>OpenAI</dd>
          </dl>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Analiza / Raporty</span>
            </div>
            <Badge variant="secondary" className="font-mono text-xs">
              {ANALYSIS_MODEL}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Wejście</dt>
            <dd className="font-mono">${ANALYSIS_COST_PER_1M_IN}/1M tokenów</dd>
            <dt className="text-muted-foreground">Wyjście</dt>
            <dd className="font-mono">
              ${ANALYSIS_COST_PER_1M_OUT}/1M tokenów
            </dd>
            <dt className="text-muted-foreground">Provider</dt>
            <dd>OpenAI</dd>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Token usage card ─────────────────────────────────────────────────────────

// analysis model pricing (USD / 1M tokens)
const LLM_COST_IN = 0.15;
const LLM_COST_OUT = 0.6;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function calcCostUsd(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * LLM_COST_IN +
    (completionTokens / 1_000_000) * LLM_COST_OUT
  );
}

function TokenUsageCard({ tokenStats }: { tokenStats: TokenStats | null }) {
  if (!tokenStats) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4" />
            Zużycie tokenów (LLM)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Brak danych — tokeny będą zliczane od nowych jobów.
          </p>
        </CardContent>
      </Card>
    );
  }

  const estimatedCost = calcCostUsd(
    tokenStats.promptTokens,
    tokenStats.completionTokens,
  );
  const embeddingType = tokenStats.byType["EMBEDDING"];
  const reportType = tokenStats.byType["REPORT"];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Zap className="size-4" />
          Zużycie tokenów (LLM)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground">Input</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">
              {fmtTokens(tokenStats.promptTokens)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground">Output</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">
              {fmtTokens(tokenStats.completionTokens)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground">Łącznie</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">
              {fmtTokens(tokenStats.totalTokens)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Szac. koszt ({ANALYSIS_MODEL})
          </span>
          <span className="font-mono text-sm font-semibold">
            ${estimatedCost < 0.001 ? "<0.001" : estimatedCost.toFixed(3)}
          </span>
        </div>

        {(embeddingType || reportType) && (
          <>
            <Separator />
            <div className="space-y-1.5 text-xs">
              {embeddingType && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Embedding (analiza)
                  </span>
                  <span className="tabular-nums">
                    {fmtTokens(embeddingType.totalTokens)}
                    <span className="ml-1 text-muted-foreground">
                      / {fmt(embeddingType.jobsWithTokens)} jobów
                    </span>
                  </span>
                </div>
              )}
              {reportType && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Raporty</span>
                  <span className="tabular-nums">
                    {fmtTokens(reportType.totalTokens)}
                    <span className="ml-1 text-muted-foreground">
                      / {fmt(reportType.jobsWithTokens)} jobów
                    </span>
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Zliczone z {fmt(tokenStats.jobsWithTokens)} ukończonych jobów
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboardData,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const [onboardOpen, setOnboardOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm">Nie udało się załadować danych</p>
      </div>
    );
  }

  const {
    announcementsTotal,
    clientsTotal,
    projectsTotal,
    topicsTotal,
    stats,
    progress,
    scraperQueue,
    tokenStats,
  } = data;
  const summary = progress.summary;
  const embeddingPct =
    summary.totalItems > 0
      ? Math.round((summary.embeddedItems / summary.totalItems) * 100)
      : 0;
  const reportPct =
    summary.totalItems > 0
      ? Math.round((summary.itemsWithReport / summary.totalItems) * 100)
      : 0;
  const isScraperActive =
    (scraperQueue.counts.active ?? 0) > 0 ||
    (scraperQueue.counts.waiting ?? 0) > 0;
  const isEmbeddingActive =
    stats.embedding.running > 0 ||
    (progress.queue.active ?? 0) > 0 ||
    (progress.queue.waiting ?? 0) > 0;
  const nextSync = scraperQueue.schedule?.[0]?.next
    ? format(new Date(scraperQueue.schedule[0].next), "dd.MM.yyyy HH:mm")
    : "—";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Przegląd stanu systemu
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setOnboardOpen(true)}>
            <Plus className="size-4" />
            Nowy klient
          </Button>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw
              className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Odśwież
          </button>
        </div>
      </div>

      <OnboardingDialog open={onboardOpen} onOpenChange={setOnboardOpen} />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Building2}
          label="Klienci"
          value={clientsTotal}
          sub="w systemie"
        />
        <StatCard
          icon={FolderKanban}
          label="Projekty"
          value={projectsTotal}
          sub="aktywnych"
        />
        <StatCard
          icon={Tags}
          label="Tematy"
          value={topicsTotal}
          sub="wyszukiwania"
        />
        <StatCard
          icon={FileText}
          label="Ogłoszenia"
          value={announcementsTotal}
          sub="w bazie danych"
        />
        <StatCard
          icon={Zap}
          label="Zaembeddowane"
          value={summary.embeddedItems}
          sub={`${embeddingPct}% całości`}
        />
        <StatCard
          icon={Sparkles}
          label="Z raportem"
          value={`${reportPct}%`}
          sub={`${fmt(summary.itemsWithReport)} z ${fmt(summary.totalItems)} ogłoszeń`}
        />
      </div>

      {/* Middle row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Embedding pipeline progress */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4" />
              Pipeline przetwarzania
              {isEmbeddingActive && (
                <Badge
                  variant="default"
                  className="ml-auto animate-pulse text-xs"
                >
                  Aktywny
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Embeddingi</span>
                <span className="tabular-nums font-medium">
                  {fmt(summary.embeddedItems)} / {fmt(summary.totalItems)}
                  <span className="ml-1 text-muted-foreground">
                    ({embeddingPct}%)
                  </span>
                </span>
              </div>
              <Progress value={embeddingPct} className="h-2" />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Raporty analityczne
                </span>
                <span className="tabular-nums font-medium">
                  {fmt(summary.itemsWithReport)} / {fmt(summary.totalItems)}
                  <span className="ml-1 text-muted-foreground">
                    ({reportPct}%)
                  </span>
                </span>
              </div>
              <Progress value={reportPct} className="h-2" />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Oczekujące</p>
                <p className="font-medium tabular-nums">
                  {fmt(summary.pendingItems)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Błędy</p>
                <p
                  className={`font-medium tabular-nums ${summary.errorItems > 0 ? "text-destructive" : ""}`}
                >
                  {fmt(summary.errorItems)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Kolejka – aktywne</p>
                <p className="font-medium tabular-nums">
                  {fmt(progress.queue.active)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Kolejka – waiting</p>
                <p className="font-medium tabular-nums">
                  {fmt(progress.queue.waiting)}
                </p>
              </div>
            </div>

            {progress.bySource.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Według źródła
                  </p>
                  {progress.bySource.map((src) => (
                    <div
                      key={src.sourceSystem}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span className="w-40 shrink-0 truncate text-muted-foreground">
                        {src.sourceSystem.replace(/_/g, " ")}
                      </span>
                      <Progress
                        value={
                          src.totalItems > 0
                            ? Math.round(
                                (src.embeddedItems / src.totalItems) * 100,
                              )
                            : 0
                        }
                        className="h-1.5 flex-1"
                      />
                      <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                        {fmt(src.embeddedItems)}/{fmt(src.totalItems)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Models + token usage */}
        <div className="space-y-4">
          <ModelsCard />
          <TokenUsageCard tokenStats={tokenStats} />
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Job stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="size-4" />
              Joby systemowe
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <JobTypeRow label="Scraper" stats={stats.scraper} />
            <JobTypeRow label="Embedding" stats={stats.embedding} />
            <JobTypeRow label="Raporty" stats={stats.report} />
          </CardContent>
        </Card>

        {/* Scraper schedule */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4" />
              Harmonogram scrapera
              {isScraperActive && (
                <Badge
                  variant="default"
                  className="ml-auto animate-pulse text-xs"
                >
                  Aktywny
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Następna synchronizacja</p>
                <p className="font-medium">{nextSync}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Harmonogram</p>
                <p className="font-mono">
                  {scraperQueue.schedule?.[0]?.cron ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Ukończone runy</p>
                <p className="font-medium tabular-nums">
                  {fmt(scraperQueue.counts.completed)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Śr. czas runu</p>
                <p className="font-medium">
                  {fmtDuration(stats.scraper.avgDurationMs)}
                </p>
              </div>
            </div>

            {scraperQueue.recentCompleted.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Ostatnie runy
                  </p>
                  <div className="space-y-1.5">
                    {scraperQueue.recentCompleted.slice(0, 5).map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3 text-green-500 shrink-0" />
                          <span className="text-muted-foreground font-mono">
                            #{run.id}
                          </span>
                        </div>
                        <span className="text-muted-foreground">
                          {run.finishedAt ? fmtAgo(run.finishedAt) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {stats.scraper.lastRunAt && (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Ostatni run:{" "}
                  <span className="text-foreground">
                    {fmtDate(stats.scraper.lastRunAt)}
                  </span>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

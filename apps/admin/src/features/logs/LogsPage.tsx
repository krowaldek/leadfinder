import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Timer,
  Zap,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useScraperLogs,
  useEmbeddingLogs,
  useReportLogs,
  useLogsStats,
  useReembedProgress,
  type JobLog,
  type JobLogStatus,
  type ReembedProgress,
  type TypeStats,
} from "./logs-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "dd.MM.yyyy HH:mm:ss");
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function StatusBadge({ status }: { status: JobLogStatus }) {
  if (status === "COMPLETED") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 gap-1">
        <CheckCircle2 className="size-3" />
        Ukończony
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0 gap-1">
        <AlertCircle className="size-3" />
        Błąd
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-0 gap-1">
      <Loader2 className="size-3 animate-spin" />
      W trakcie
    </Badge>
  );
}

function StatsCard({
  title,
  icon: Icon,
  stats,
}: {
  title: string;
  icon: React.ElementType;
  stats: TypeStats | undefined;
}) {
  const iconColor =
    title === "Scrapowanie"
      ? "text-violet-500"
      : title === "Embeddingi"
        ? "text-blue-500"
        : "text-amber-500";

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`size-4 ${iconColor}`} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold tabular-nums">{stats?.total ?? "—"}</span>
          <span className="text-sm text-muted-foreground pb-0.5">łącznie</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-center">
            <p className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {stats?.completed ?? 0}
            </p>
            <p className="text-muted-foreground mt-0.5">OK</p>
          </div>
          <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-center">
            <p className="font-semibold text-red-600 dark:text-red-400 tabular-nums">
              {stats?.failed ?? 0}
            </p>
            <p className="text-muted-foreground mt-0.5">Błędy</p>
          </div>
          <div className="rounded-md bg-blue-500/10 px-2 py-1.5 text-center">
            <p className="font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
              {stats?.running ?? 0}
            </p>
            <p className="text-muted-foreground mt-0.5">Live</p>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground pt-1 border-t">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> Ostatni run
            </span>
            <span className="font-mono">
              {stats?.lastRunAt
                ? formatDistanceToNow(new Date(stats.lastRunAt), {
                    addSuffix: true,
                    locale: pl,
                  })
                : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Timer className="size-3" /> Śr. czas
            </span>
            <span className="font-mono">{formatDuration(stats?.avgDurationMs)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ReembedProgressCard({
  progress,
  isLoading,
}: {
  progress: ReembedProgress | undefined;
  isLoading: boolean;
}) {
  const summary = progress?.summary;
  const queue = progress?.queue;
  const coverage = summary?.reembedCoverage ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Activity className="size-4 text-sky-500" />
          Migracja report-first
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Pokrycie nowych embeddingów</span>
            <span className="font-mono text-muted-foreground">
              {isLoading || !summary ? "—" : percent(coverage)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${Math.max(0, Math.min(coverage * 100, 100))}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {isLoading || !summary
              ? "Ładowanie stanu migracji…"
              : `${summary.embeddedWithReport.toLocaleString("pl-PL")} z ${summary.embeddedItems.toLocaleString("pl-PL")} osadzonych pozycji ma już raport itemu.`}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md bg-sky-500/10 px-3 py-2">
            <p className="text-xs text-muted-foreground">Nowe embeddingi</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {summary?.embeddedWithReport?.toLocaleString("pl-PL") ?? "—"}
            </p>
          </div>
          <div className="rounded-md bg-amber-500/10 px-3 py-2">
            <p className="text-xs text-muted-foreground">Legacy embeddingi</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {summary?.legacyEmbeddedItems?.toLocaleString("pl-PL") ?? "—"}
            </p>
          </div>
          <div className="rounded-md bg-blue-500/10 px-3 py-2">
            <p className="text-xs text-muted-foreground">W kolejce</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {queue ? (queue.waiting + queue.active).toLocaleString("pl-PL") : "—"}
            </p>
          </div>
          <div className="rounded-md bg-emerald-500/10 px-3 py-2">
            <p className="text-xs text-muted-foreground">Raporty itemów</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {summary?.itemsWithReport?.toLocaleString("pl-PL") ?? "—"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Źródło</TableHead>
                  <TableHead className="text-right">Pokrycie</TableHead>
                  <TableHead className="text-right">Legacy</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      <Loader2 className="size-4 animate-spin inline mr-2" />
                      Ładowanie…
                    </TableCell>
                  </TableRow>
                ) : !progress || progress.bySource.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      Brak danych migracji
                    </TableCell>
                  </TableRow>
                ) : (
                  progress.bySource.map((row) => (
                    <TableRow key={row.sourceSystem}>
                      <TableCell className="text-xs font-medium">{row.sourceSystem}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{percent(row.reembedCoverage)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{row.legacyEmbeddedItems}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{row.pendingItems}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-md border p-3 space-y-2 text-xs">
            <p className="font-medium text-sm">Stan kolejki embedding</p>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Waiting</span>
              <span className="font-mono">{queue?.waiting ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active</span>
              <span className="font-mono">{queue?.active ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Completed</span>
              <span className="font-mono">{queue?.completed ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Failed</span>
              <span className="font-mono">{queue?.failed ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Delayed</span>
              <span className="font-mono">{queue?.delayed ?? "—"}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Scraper Logs Table ────────────────────────────────────────────────────────

function ScraperLogsTable({
  logs,
  isLoading,
}: {
  logs: JobLog[];
  isLoading: boolean;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Czas startu</TableHead>
            <TableHead className="w-[140px]">Job</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[90px]">Czas trwania</TableHead>
            <TableHead>Wynik</TableHead>
            <TableHead className="max-w-[300px]">Błąd</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                <Loader2 className="size-4 animate-spin inline mr-2" />
                Ładowanie…
              </TableCell>
            </TableRow>
          ) : logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                Brak logów scrapowania
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log) => {
              const result = log.result as Record<string, unknown> | null;
              return (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {formatDate(log.startedAt)}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.jobName}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={log.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatDuration(log.durationMs)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {result ? (
                      <div className="flex flex-wrap gap-2">
                        {result.skipped === true && (
                          <span className="text-muted-foreground">Pominięto (brak konfiguracji)</span>
                        )}
                        {result.discovered != null && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                            odkryte: <strong>{String(result.discovered)}</strong>
                          </span>
                        )}
                        {result.saved != null && (
                          <span className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 font-mono">
                            zapisane: <strong>{String(result.saved)}</strong>
                          </span>
                        )}
                        {result.failed != null && Number(result.failed) > 0 && (
                          <span className="rounded bg-red-500/10 text-red-700 dark:text-red-300 px-1.5 py-0.5 font-mono">
                            błędy: <strong>{String(result.failed)}</strong>
                          </span>
                        )}
                        {result.source != null && (
                          <span className="text-muted-foreground">{String(result.source)}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {log.error ? (
                      <span className="text-xs text-red-600 dark:text-red-400 font-mono break-all line-clamp-3" title={log.error}>
                        {log.error}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Embedding Logs Table ──────────────────────────────────────────────────────

function EmbeddingLogsTable({
  logs,
  isLoading,
}: {
  logs: JobLog[];
  isLoading: boolean;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Czas startu</TableHead>
            <TableHead className="w-[120px]">Job</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[90px]">Czas trwania</TableHead>
            <TableHead>Element</TableHead>
            <TableHead className="w-[100px]">Kind</TableHead>
            <TableHead className="max-w-[300px]">Błąd</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                <Loader2 className="size-4 animate-spin inline mr-2" />
                Ładowanie…
              </TableCell>
            </TableRow>
          ) : logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                Brak logów embeddingów
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log) => {
              const payload = log.payload as Record<string, unknown> | null;
              const result = log.result as Record<string, unknown> | null;
              const kind = (result?.kind ?? payload?.kind) as string | null | undefined;
              return (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {formatDate(log.startedAt)}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.jobName}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={log.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatDuration(log.durationMs)}
                  </TableCell>
                  <TableCell className="text-xs max-w-[280px]">
                    {log.entityTitle ? (
                      <div className="space-y-0.5">
                        <p className="truncate font-medium" title={log.entityTitle}>
                          {log.entityTitle}
                        </p>
                        {log.entityId && (
                          <p className="font-mono text-[10px] text-muted-foreground truncate">
                            {log.entityId}
                          </p>
                        )}
                      </div>
                    ) : log.entityId ? (
                      <code className="text-[10px] text-muted-foreground">{log.entityId}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {kind ? (
                      <Badge variant="outline" className="text-xs font-mono">
                        {kind}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {log.error ? (
                      <span className="text-xs text-red-600 dark:text-red-400 font-mono break-all line-clamp-3" title={log.error}>
                        {log.error}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Report Logs Table ─────────────────────────────────────────────────────────

function ReportLogsTable({
  logs,
  isLoading,
}: {
  logs: JobLog[];
  isLoading: boolean;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Czas startu</TableHead>
            <TableHead className="w-[140px]">Job</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[90px]">Czas trwania</TableHead>
            <TableHead>Encja</TableHead>
            <TableHead className="w-[100px]">Dł. raportu</TableHead>
            <TableHead className="w-[80px]">Pozycje</TableHead>
            <TableHead className="w-[80px]">Załączniki</TableHead>
            <TableHead>Detale</TableHead>
            <TableHead className="max-w-[300px]">Błąd</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                <Loader2 className="size-4 animate-spin inline mr-2" />
                Ładowanie…
              </TableCell>
            </TableRow>
          ) : logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                Brak logów raportów
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log) => {
              const result = log.result as Record<string, unknown> | null;
              const summary =
                typeof result?.summary === "string" ? result.summary : null;
              return (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {formatDate(log.startedAt)}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.jobName}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={log.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatDuration(log.durationMs)}
                  </TableCell>
                  <TableCell className="text-xs max-w-[300px]">
                    {log.entityTitle || result?.title ? (
                      <div className="space-y-0.5">
                        <p className="truncate font-medium" title={String(log.entityTitle ?? result?.title)}>
                          {String(log.entityTitle ?? result?.title)}
                        </p>
                        {log.entityId && (
                          <p className="font-mono text-[10px] text-muted-foreground truncate">
                            {log.entityId}
                          </p>
                        )}
                      </div>
                    ) : log.entityId ? (
                      <code className="text-[10px] text-muted-foreground">{log.entityId}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {result?.reportLength != null ? (
                      <span>{Number(result.reportLength).toLocaleString()} zn</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-center">
                    {result?.itemsCount != null ? String(result.itemsCount) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-center">
                    {result?.attachmentsProcessed != null
                      ? String(result.attachmentsProcessed)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs max-w-[360px]">
                    <div className="space-y-1">
                      {result?.kind != null && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {String(result.kind)}
                        </Badge>
                      )}
                      {result?.estimatedValue != null && (
                        <p className="text-muted-foreground font-mono">
                          est.: {Number(result.estimatedValue).toLocaleString()} PLN
                        </p>
                      )}
                      {result?.queuedEmbeddings != null && (
                        <p className="text-muted-foreground font-mono">
                          queued embeddings: {String(result.queuedEmbeddings)}
                        </p>
                      )}
                      {result?.queuedAnnouncementReport != null && (
                        <p className="text-muted-foreground font-mono">
                          queued ann. report: {String(result.queuedAnnouncementReport)}
                        </p>
                      )}
                      {summary ? (
                        <p className="line-clamp-3" title={summary}>{summary}</p>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {log.error ? (
                      <span className="text-xs text-red-600 dark:text-red-400 font-mono break-all line-clamp-3" title={log.error}>
                        {log.error}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({
  page,
  pages,
  total,
  limit,
  onPageChange,
}: {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPageChange: (p: number) => void;
}) {
  if (pages <= 1) return null;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-1 pt-2 text-sm text-muted-foreground">
      <span>
        {start}–{end} z {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Poprzednia
        </Button>
        <span className="text-xs font-mono">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Następna
        </Button>
      </div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  status,
  onStatusChange,
  total,
  onRefresh,
  isLoading,
}: {
  status: JobLogStatus | undefined;
  onStatusChange: (s: JobLogStatus | undefined) => void;
  total: number | undefined;
  onRefresh: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Select
        value={status ?? "ALL"}
        onValueChange={(v) => onStatusChange(v === "ALL" ? undefined : (v as JobLogStatus))}
      >
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue placeholder="Wszystkie" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Wszystkie</SelectItem>
          <SelectItem value="COMPLETED">Ukończone</SelectItem>
          <SelectItem value="FAILED">Błędy</SelectItem>
          <SelectItem value="STARTED">W trakcie</SelectItem>
        </SelectContent>
      </Select>

      {total != null && (
        <span className="text-xs text-muted-foreground">{total} wpisów</span>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-8 gap-1.5"
        onClick={onRefresh}
        disabled={isLoading}
      >
        <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
        Odśwież
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function LogsPage() {
  const { data: stats, isLoading: statsLoading } = useLogsStats();
  const { data: reembedProgress, isLoading: reembedLoading } = useReembedProgress();

  // Scraper state
  const [scraperPage, setScraperPage] = useState(1);
  const [scraperStatus, setScraperStatus] = useState<JobLogStatus | undefined>();
  const { data: scraperData, isLoading: scraperLoading, refetch: refetchScraper } = useScraperLogs({
    page: scraperPage,
    limit: 50,
    status: scraperStatus,
  });

  // Embedding state
  const [embedPage, setEmbedPage] = useState(1);
  const [embedStatus, setEmbedStatus] = useState<JobLogStatus | undefined>();
  const { data: embedData, isLoading: embedLoading, refetch: refetchEmbed } = useEmbeddingLogs({
    page: embedPage,
    limit: 50,
    status: embedStatus,
  });

  // Report state
  const [reportPage, setReportPage] = useState(1);
  const [reportStatus, setReportStatus] = useState<JobLogStatus | undefined>();
  const { data: reportData, isLoading: reportLoading, refetch: refetchReport } = useReportLogs({
    page: reportPage,
    limit: 50,
    status: reportStatus,
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Logi systemowe</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historia operacji scrapowania, embeddingów i generowania raportów.
          Dane odświeżane automatycznie co 10 sekund.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatsCard
          title="Scrapowanie"
          icon={Database}
          stats={statsLoading ? undefined : stats?.scraper}
        />
        <StatsCard
          title="Embeddingi"
          icon={Zap}
          stats={statsLoading ? undefined : stats?.embedding}
        />
        <StatsCard
          title="Raporty"
          icon={FileText}
          stats={statsLoading ? undefined : stats?.report}
        />
      </div>

      <ReembedProgressCard
        progress={reembedProgress}
        isLoading={reembedLoading}
      />

      {/* Tabs */}
      <Tabs defaultValue="scraper" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scraper" className="gap-2">
            <Database className="size-3.5" />
            Scrapowanie
            {stats && (
              <span className="ml-1 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400 px-1.5 py-0 text-[10px] font-bold tabular-nums">
                {stats.scraper.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="embedding" className="gap-2">
            <Zap className="size-3.5" />
            Embeddingi
            {stats && (
              <span className="ml-1 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 px-1.5 py-0 text-[10px] font-bold tabular-nums">
                {stats.embedding.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="size-3.5" />
            Raporty
            {stats && (
              <span className="ml-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0 text-[10px] font-bold tabular-nums">
                {stats.report.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* SCRAPER TAB */}
        <TabsContent value="scraper">
          <div className="space-y-2">
            <FilterBar
              status={scraperStatus}
              onStatusChange={(s) => { setScraperStatus(s); setScraperPage(1); }}
              total={scraperData?.meta.total}
              onRefresh={() => void refetchScraper()}
              isLoading={scraperLoading}
            />
            <ScrollArea className="w-full">
              <ScraperLogsTable
                logs={scraperData?.data ?? []}
                isLoading={scraperLoading}
              />
            </ScrollArea>
            <Pagination
              page={scraperPage}
              pages={scraperData?.meta.pages ?? 1}
              total={scraperData?.meta.total ?? 0}
              limit={50}
              onPageChange={setScraperPage}
            />
          </div>
        </TabsContent>

        {/* EMBEDDING TAB */}
        <TabsContent value="embedding">
          <div className="space-y-2">
            <FilterBar
              status={embedStatus}
              onStatusChange={(s) => { setEmbedStatus(s); setEmbedPage(1); }}
              total={embedData?.meta.total}
              onRefresh={() => void refetchEmbed()}
              isLoading={embedLoading}
            />
            <ScrollArea className="w-full">
              <EmbeddingLogsTable
                logs={embedData?.data ?? []}
                isLoading={embedLoading}
              />
            </ScrollArea>
            <Pagination
              page={embedPage}
              pages={embedData?.meta.pages ?? 1}
              total={embedData?.meta.total ?? 0}
              limit={50}
              onPageChange={setEmbedPage}
            />
          </div>
        </TabsContent>

        {/* REPORTS TAB */}
        <TabsContent value="reports">
          <div className="space-y-2">
            <FilterBar
              status={reportStatus}
              onStatusChange={(s) => { setReportStatus(s); setReportPage(1); }}
              total={reportData?.meta.total}
              onRefresh={() => void refetchReport()}
              isLoading={reportLoading}
            />
            <ScrollArea className="w-full">
              <ReportLogsTable
                logs={reportData?.data ?? []}
                isLoading={reportLoading}
              />
            </ScrollArea>
            <Pagination
              page={reportPage}
              pages={reportData?.meta.pages ?? 1}
              total={reportData?.meta.total ?? 0}
              limit={50}
              onPageChange={setReportPage}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

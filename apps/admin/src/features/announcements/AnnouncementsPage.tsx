import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { useMemo, useState } from "react";
import { useDebounce } from "@/lib/use-debounce";
import { toast } from "sonner";
import {
  DataTable,
  type ColumnDef,
  type RowAction,
} from "../../../components/data-table";
import {
  type Announcement,
  type AnnouncementSource,
  type AnnouncementStatus,
} from "@leadfinder/contracts";
import { fetchAnnouncement, fetchAnnouncements, triggerScraper, triggerEzScraper, triggerPzScraper, fetchQueueStatus, backfillDeadlines, backfillKind } from "./announcements-api";
import {
  RawDataDialog,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/components/RawDataDialog";
import { AnnouncementAiSearchDialog } from "@/components/AnnouncementAiSearchDialog";
import { AnnouncementReportDialog } from "@/components/AnnouncementReportDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InternalAnnouncementPromptPanel } from "./InternalAnnouncementPromptPanel";

const PAGE_SIZE = 20;
const EXPORT_BATCH_SIZE = 100;

const SOURCE_OPTIONS: { value: AnnouncementSource | "ALL"; label: string }[] = [
  { value: "ALL", label: "Wszystkie źródła" },
  { value: "BAZA_KONKURENCYJNOSCI", label: "Baza Konk." },
  { value: "E_ZAMOWIENIA", label: "e-Zamówienia" },
  { value: "PLATFORMA_ZAKUPOWA", label: "Platf. Zakup." },
  { value: "INTERNAL", label: "Wewnętrzne" },
];

const STATUS_OPTIONS: { value: AnnouncementStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Wszystkie statusy" },
  { value: "OPEN", label: "Aktywne" },
  { value: "CLOSED", label: "Zakończone" },
  { value: "AWARDED", label: "Rozstrzygnięte" },
  { value: "UNKNOWN", label: "Nieznany" },
];

function readInitialAnnouncementFilters(): {
  search: string;
  source: AnnouncementSource | "ALL";
  status: AnnouncementStatus | "ALL";
  announcementId: string | null;
} {
  if (typeof window === "undefined") {
    return { search: "", source: "ALL", status: "ALL", announcementId: null };
  }

  const params = new URLSearchParams(window.location.search);
  const search = params.get("search")?.trim() ?? "";
  const source = params.get("source");
  const status = params.get("status");
  const announcementId = params.get("id")?.trim() ?? null;

  return {
    search,
    source:
      source && SOURCE_OPTIONS.some((option) => option.value === source)
        ? (source as AnnouncementSource)
        : "ALL",
    status:
      status && STATUS_OPTIONS.some((option) => option.value === status)
        ? (status as AnnouncementStatus)
        : "ALL",
    announcementId,
  };
}

function statusVariant(status: AnnouncementStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "OPEN") return "default";
  if (status === "AWARDED") return "secondary";
  return "outline";
}

function ScraperPanel() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["scraper-queue-status"],
    queryFn: fetchQueueStatus,
    refetchInterval: 5000,
  });

  const triggerBkMutation = useMutation({
    mutationFn: triggerScraper,
    onSuccess: (data) => {
      toast.success(`Scraper BK uruchomiony (job ${data.jobId})`);
      void queryClient.invalidateQueries({ queryKey: ["scraper-queue-status"] });
    },
    onError: () => toast.error("Nie udało się uruchomić scrapera BK"),
  });

  const triggerEzMutation = useMutation({
    mutationFn: triggerEzScraper,
    onSuccess: (data) => {
      toast.success(`Scraper e-Zamówienia uruchomiony (job ${data.jobId})`);
      void queryClient.invalidateQueries({ queryKey: ["scraper-queue-status"] });
    },
    onError: () => toast.error("Nie udało się uruchomić scrapera e-Zamówienia"),
  });

  const triggerPzMutation = useMutation({
    mutationFn: triggerPzScraper,
    onSuccess: (data) => {
      toast.success(`Scraper Platforma Zakupowa uruchomiony (job ${data.jobId})`);
      void queryClient.invalidateQueries({ queryKey: ["scraper-queue-status"] });
    },
    onError: () => toast.error("Nie udało się uruchomić scrapera Platforma Zakupowa"),
  });

  const backfillDeadlinesMutation = useMutation({
    mutationFn: backfillDeadlines,
    onSuccess: (data) => toast.success(`Uzupełniono ${data.updated} terminów składania`),
    onError: () => toast.error("Nie udało się uzupełnić terminów"),
  });

  const backfillKindMutation = useMutation({
    mutationFn: backfillKind,
    onSuccess: (data) => toast.success(`Zakolejkowano ${data.queued} embedingów do klasyfikacji`),
    onError: () => toast.error("Nie udało się uruchomić backfill rodzaju"),
  });

  const counts = statusQuery.data?.counts;
  const lastRun = statusQuery.data?.recentCompleted?.[0];
  const lastFailed = statusQuery.data?.recentFailed?.[0];
  const isActive = (counts?.active ?? 0) > 0 || (counts?.waiting ?? 0) > 0;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-block size-2.5 rounded-full",
                isActive ? "animate-pulse bg-yellow-500" : "bg-green-500",
              )}
            />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Kolejka scraperów</p>
              <p className="text-sm font-medium">
                {isActive ? "Aktywna" : "Gotowa"}
                {counts && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    aktywne: {counts.active} · oczekujące: {counts.waiting} · ukończone:{" "}
                    {counts.completed} · błędy: {counts.failed}
                  </span>
                )}
              </p>
            </div>
          </div>
          {lastRun?.finishedAt && (
            <p className="text-xs text-muted-foreground">
              Ostatni run:{" "}
              <span className="text-foreground">
                {formatDistanceToNow(new Date(lastRun.finishedAt), {
                  addSuffix: true,
                  locale: pl,
                })}
              </span>
              {lastFailed?.failedReason && (
                <span className="ml-2 text-destructive">
                  ⚠ {lastFailed.failedReason.slice(0, 60)}
                </span>
              )}
            </p>
          )}
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => triggerBkMutation.mutate()}
            disabled={triggerBkMutation.isPending || isActive}
          >
            {triggerBkMutation.isPending ? "Kolejkowanie…" : isActive ? "Trwa…" : "Uruchom BK"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => triggerEzMutation.mutate()}
            disabled={triggerEzMutation.isPending || isActive}
          >
            {triggerEzMutation.isPending ? "Kolejkowanie…" : isActive ? "Trwa…" : "Uruchom e-Zamówienia"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => triggerPzMutation.mutate()}
            disabled={triggerPzMutation.isPending || isActive}
          >
            {triggerPzMutation.isPending ? "Kolejkowanie…" : isActive ? "Trwa…" : "Uruchom Platforma Zakupowa"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => backfillDeadlinesMutation.mutate()}
              disabled={backfillDeadlinesMutation.isPending}
              title="Uzupełnij terminy składania z zapisanych danych (rawData)"
            >
              {backfillDeadlinesMutation.isPending ? "Trwa…" : "Backfill terminów"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => backfillKindMutation.mutate()}
              disabled={backfillKindMutation.isPending}
              title="Sklasyfikuj rodzaj dla ogłoszeń bez klasyfikacji"
            >
              {backfillKindMutation.isPending ? "Trwa…" : "Backfill rodzaju"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AnnouncementsPage() {
  const initialFilters = readInitialAnnouncementFilters();
  const [inputSearch, setInputSearch] = useState(initialFilters.search);
  const debouncedSearch = useDebounce(inputSearch, 400);
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<AnnouncementSource | "ALL">(initialFilters.source);
  const [statusFilter, setStatusFilter] = useState<AnnouncementStatus | "ALL">(initialFilters.status);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [reportTarget, setReportTarget] = useState<Announcement | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

  function escapeCsvCell(value: string) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  function buildAnnouncementsCsvRows(announcements: Announcement[]) {
    const header = ["tytul", "link", "termin"];
    const rows = announcements.map((announcement) => [
      announcement.displayTitle ?? announcement.title,
      announcement.url,
      announcement.deadlineAt
        ? format(new Date(announcement.deadlineAt), "yyyy-MM-dd")
        : "",
    ]);

    return [header, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");
  }

  function downloadAnnouncementsCsv(content: string) {
    const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const dateStamp = format(new Date(), "yyyy-MM-dd");

    anchor.href = url;
    anchor.download = `ogloszenia-${dateStamp}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const query = useQuery({
    queryKey: ["announcements", debouncedSearch, page, PAGE_SIZE, sourceFilter, statusFilter],
    queryFn: () =>
      fetchAnnouncements({
        search: debouncedSearch,
        page,
        limit: PAGE_SIZE,
        source: sourceFilter === "ALL" ? undefined : sourceFilter,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      }),
  });

  const exactAnnouncementQuery = useQuery({
    queryKey: ["announcement", initialFilters.announcementId],
    queryFn: () => fetchAnnouncement(initialFilters.announcementId!),
    enabled: Boolean(initialFilters.announcementId),
  });

  const announcements = query.data?.data ?? [];
  const exactAnnouncement = exactAnnouncementQuery.data?.data ?? null;
  const visibleAnnouncements = useMemo(
    () => exactAnnouncement
      ? [exactAnnouncement, ...announcements.filter((announcement) => announcement.id !== exactAnnouncement.id)]
      : announcements,
    [announcements, exactAnnouncement],
  );
  const meta = query.data?.meta;

  const exportCsvMutation = useMutation({
    mutationFn: async () => {
      const totalItems = meta?.total ?? visibleAnnouncements.length;

      if (totalItems === 0) {
        return [] as Announcement[];
      }

      const totalPages = Math.ceil(totalItems / EXPORT_BATCH_SIZE);
      const items: Announcement[] = [];

      for (let exportPage = 1; exportPage <= totalPages; exportPage += 1) {
        const response = await fetchAnnouncements({
          search: debouncedSearch,
          page: exportPage,
          limit: EXPORT_BATCH_SIZE,
          source: sourceFilter === "ALL" ? undefined : sourceFilter,
          status: statusFilter === "ALL" ? undefined : statusFilter,
        });

        items.push(...response.data);
      }

      return items;
    },
    onSuccess: (items) => {
      if (items.length === 0) {
        toast.error("Brak ogłoszeń do eksportu");
        return;
      }

      downloadAnnouncementsCsv(buildAnnouncementsCsvRows(items));
      toast.success(`Wyeksportowano ${items.length} ogłoszeń do CSV`);
    },
    onError: () => {
      toast.error("Nie udało się wyeksportować ogłoszeń");
    },
  });

  const columns = useMemo<ColumnDef<Announcement>[]>(
    () => [
      {
        id: "title",
        header: "Ogłoszenie",
        accessorFn: (a) => a,
        cell: ({ row }) => (
          <div className="max-w-[420px]">
            <div className="line-clamp-2 font-medium">{row.displayTitle ?? row.title}</div>
            {(row.contractingAuthority || row.location) ? (
              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {[row.contractingAuthority, row.location].filter(Boolean).join(" · ")}
              </div>
            ) : null}
            {row.description ? (
              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {row.description}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "source",
        header: "Źródło",
        accessorFn: (a) => a.sourceSystem,
        cell: ({ row }) => (
          <Badge variant="secondary">{SOURCE_LABELS[row.sourceSystem]}</Badge>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (a) => a.status,
        cell: ({ row }) => (
          <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
        ),
      },
      {
        id: "deadline",
        header: "Termin",
        accessorFn: (a) => a.deadlineAt,
        cell: ({ row }) =>
          row.deadlineAt ? (
            <span
              className={cn(
                "text-sm",
                new Date(row.deadlineAt) < new Date() ? "text-muted-foreground" : "",
              )}
            >
              {format(new Date(row.deadlineAt), "dd.MM.yyyy")}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "value",
        header: "Wartość",
        accessorFn: (a) => a.valueMin,
        cell: ({ row }) => {
          if (!row.valueMin && !row.valueMax)
            return <span className="text-muted-foreground">—</span>;
          const fmt = (v: string) =>
            Number(v).toLocaleString("pl-PL", {
              style: "currency",
              currency: "PLN",
              maximumFractionDigits: 0,
            });
          if (row.valueMin && row.valueMax && row.valueMin !== row.valueMax) {
            return (
              <span className="text-sm">
                {fmt(row.valueMin)} – {fmt(row.valueMax)}
              </span>
            );
          }
          return <span className="text-sm">{fmt((row.valueMin ?? row.valueMax)!)}</span>;
        },
      },
      {
        id: "llmValue",
        header: "Wartość (LLM)",
        accessorFn: (a) => a.llmEstimatedValue ?? null,
        cell: ({ row }) => {
          const val = row.llmEstimatedValue;
          if (!val) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <span className="text-sm font-medium tabular-nums">
              {Number(val).toLocaleString("pl-PL", {
                style: "currency",
                currency: "PLN",
                maximumFractionDigits: 0,
              })}
            </span>
          );
        },
      },
      {
        id: "createdAt",
        header: "Dodano",
        accessorFn: (a) => format(new Date(a.createdAt), "dd.MM.yyyy"),
      },
    ],
    [],
  );

  const rowActions = useMemo<RowAction<Announcement>[]>(
    () => [
      {
        id: "preview",
        label: "Podgląd danych",
        onClick: (a) => setSelected(a),
      },
      {
        id: "report",
        label: "Podsumowanie",
        onClick: (a) => setReportTarget(a),
      },
      {
        id: "open",
        label: "Otwórz w źródle",
        onClick: (a) => window.open(a.url, "_blank", "noreferrer"),
      },
    ],
    [],
  );

  return (
    <div className="grid gap-6">
      <Tabs defaultValue="list" className="space-y-6">
        <TabsList>
          <TabsTrigger value="list">Lista ogłoszeń</TabsTrigger>
          <TabsTrigger value="create">Dodaj ogłoszenie</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <ScraperPanel />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={sourceFilter === opt.value ? "default" : "outline"}
                  size="xs"
                  onClick={() => {
                    setSourceFilter(opt.value);
                    setPage(1);
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <Separator orientation="vertical" className="hidden h-6 sm:block" />
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={statusFilter === opt.value ? "default" : "outline"}
                  size="xs"
                  onClick={() => {
                    setStatusFilter(opt.value);
                    setPage(1);
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCsvMutation.mutate()}
                disabled={exportCsvMutation.isPending || (meta?.total ?? visibleAnnouncements.length) === 0}
              >
                {exportCsvMutation.isPending ? "Eksport CSV…" : "Eksport CSV"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAiDialogOpen(true)}>
                AI Match Lab
              </Button>
            </div>
          </div>

          {meta && (
            <p className="text-sm text-muted-foreground">
              Łącznie w bazie:{" "}
              <span className="font-semibold text-foreground">
                {meta.total.toLocaleString("pl-PL")}
              </span>{" "}
              ogłoszeń
            </p>
          )}

          <DataTable
            data={visibleAnnouncements}
            columns={columns}
            rowActions={rowActions}
            isLoading={query.isLoading}
            loadingMessage="Ładowanie ogłoszeń..."
            searchEnabled
            searchValue={inputSearch}
            searchPlaceholder="Szukaj po tytule ogłoszenia"
            onSearchChange={(value) => {
              setInputSearch(value);
              setPage(1);
            }}
            pagination={{
              enabled: true,
              currentPage: meta?.page ?? page,
              pageSize: meta?.limit ?? PAGE_SIZE,
              totalItems: meta?.total ?? 0,
              onPageChange: (nextPage) => setPage(nextPage),
            }}
            emptyState={{
              title: "Brak ogłoszeń dla podanych kryteriów.",
              description: "Spróbuj zmienić filtry lub uruchom scraper.",
            }}
          />
        </TabsContent>

        <TabsContent value="create" className="space-y-4">
          <Card>
            <CardContent className="space-y-3 py-5">
              <div>
                <p className="text-sm font-medium">Dodaj ogłoszenie wewnętrzne</p>
                <p className="text-sm text-muted-foreground">
                  Opisz potrzebę zakupową własnymi słowami. Asystent dopyta o braki i zapisze wynik do tej samej tabeli ogłoszeń, więc embedding i matching ruszą automatycznie.
                </p>
              </div>
            </CardContent>
          </Card>

          <InternalAnnouncementPromptPanel
            onCreated={(announcement) => {
              setSourceFilter("INTERNAL");
              setPage(1);
              setReportTarget(announcement);
            }}
          />
        </TabsContent>
      </Tabs>

      <RawDataDialog
        announcement={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
      <AnnouncementReportDialog
        announcement={reportTarget}
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
      />
      <AnnouncementAiSearchDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
      />
    </div>
  );
}


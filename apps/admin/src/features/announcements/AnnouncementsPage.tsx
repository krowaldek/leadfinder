import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { useMemo, useState } from "react";
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
import { fetchAnnouncements, triggerScraper, fetchQueueStatus, backfillDeadlines, backfillKind } from "./announcements-api";
import {
  RawDataDialog,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/components/RawDataDialog";
import { AnnouncementAiSearchDialog } from "@/components/AnnouncementAiSearchDialog";

const PAGE_SIZE = 20;

const SOURCE_OPTIONS: { value: AnnouncementSource | "ALL"; label: string }[] = [
  { value: "ALL", label: "Wszystkie źródła" },
  { value: "BAZA_KONKURENCYJNOSCI", label: "Baza Konk." },
  { value: "E_ZAMOWIENIA", label: "e-Zamówienia" },
  { value: "PLATFORMA_ZAKUPOWA", label: "Platf. Zakup." },
];

const STATUS_OPTIONS: { value: AnnouncementStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Wszystkie statusy" },
  { value: "OPEN", label: "Aktywne" },
  { value: "CLOSED", label: "Zakończone" },
  { value: "AWARDED", label: "Rozstrzygnięte" },
  { value: "UNKNOWN", label: "Nieznany" },
];

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

  const triggerMutation = useMutation({
    mutationFn: triggerScraper,
    onSuccess: (data) => {
      toast.success(`Scraper uruchomiony (job ${data.jobId})`);
      void queryClient.invalidateQueries({ queryKey: ["scraper-queue-status"] });
    },
    onError: () => toast.error("Nie udało się uruchomić scrapera"),
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
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-block size-2.5 rounded-full",
                isActive ? "animate-pulse bg-yellow-500" : "bg-green-500",
              )}
            />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Scraper BK</p>
              <p className="text-sm font-medium">
                {isActive ? "Aktywny" : "Gotowy"}
                {counts && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    aktywne: {counts.active} · oczekujące: {counts.waiting} · ukończone:{" "}
                    {counts.completed} · błędy: {counts.failed}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
            <Button
              size="sm"
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending || isActive}
            >
              {triggerMutation.isPending ? "Kolejkowanie…" : isActive ? "Trwa…" : "Uruchom scraper"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AnnouncementsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<AnnouncementSource | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<AnnouncementStatus | "ALL">("ALL");
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

  const query = useQuery({
    queryKey: ["announcements", search, page, PAGE_SIZE, sourceFilter, statusFilter],
    queryFn: () =>
      fetchAnnouncements({
        search,
        page,
        limit: PAGE_SIZE,
        source: sourceFilter === "ALL" ? undefined : sourceFilter,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      }),
  });

  const announcements = query.data?.data ?? [];
  const meta = query.data?.meta;

  const columns = useMemo<ColumnDef<Announcement>[]>(
    () => [
      {
        id: "title",
        header: "Ogłoszenie",
        accessorFn: (a) => a,
        cell: ({ row }) => (
          <div className="max-w-[420px]">
            <div className="line-clamp-2 font-medium">{row.title}</div>
            {row.description && (
              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {row.description}
              </div>
            )}
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
        id: "open",
        label: "Otwórz w źródle",
        onClick: (a) => window.open(a.url, "_blank", "noreferrer"),
      },
    ],
    [],
  );

  return (
    <div className="grid gap-6">
      <ScraperPanel />

      {/* Filters */}
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
        <div className="ml-auto">
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
        data={announcements}
        columns={columns}
        rowActions={rowActions}
        isLoading={query.isLoading}
        loadingMessage="Ładowanie ogłoszeń..."
        searchEnabled
        searchValue={search}
        searchPlaceholder="Szukaj po tytule ogłoszenia"
        onSearchChange={(value) => {
          setSearch(value);
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

      <RawDataDialog
        announcement={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
      <AnnouncementAiSearchDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
      />
    </div>
  );
}


import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, ExternalLink, Search, Info, FileText } from "lucide-react";
import { DataTable, type ColumnDef } from "../../../components/data-table";
import { type ClientMatchResponse } from "@leadfinder/contracts";
import { fetchClients, fetchClientMatches, fetchProjects, fetchTopics, rematchClient, updateMatchStatus } from "./clients-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MatchDetailSheet } from "@/components/MatchDetailSheet";
import { AnnouncementReportDialog } from "@/components/AnnouncementReportDialog";
import type { Announcement } from "@leadfinder/contracts";

// ── Labels ───────────────────────────────────────────────────────────────────

const MATCH_STATUS_LABELS: Record<string, string> = {
  NEW: "Nowe",
  VIEWED: "Wyświetlone",
  DISMISSED: "Odrzucone",
  SHORTLISTED: "Wybrane",
};

const KIND_LABELS: Record<string, string> = {
  DOSTAWA: "Dostawa",
  USLUGA: "Usługa",
  ROBOTY_BUDOWLANE: "Roboty bud.",
  SZKOLENIE: "Szkolenie",
  USLUGA_IT: "Usługi IT",
  USLUGA_BADAWCZO_ROZWOJOWA: "B+R",
  DORADZTWO: "Doradztwo",
  INNE: "Inne",
};

// ── Sorting ──────────────────────────────────────────────────────────────────

type SortCol = "title" | "similarity" | "deadlineAt" | "publishedAt";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (sortCol !== col) return <ArrowUpDown className="ml-1 inline size-3.5 opacity-40" />;
  return sortDir === "asc" ? <ArrowUp className="ml-1 inline size-3.5" /> : <ArrowDown className="ml-1 inline size-3.5" />;
}

function SortHeader({
  col, label, sortCol, sortDir, onToggle,
}: {
  col: SortCol; label: string; sortCol: SortCol; sortDir: SortDir; onToggle: (col: SortCol) => void;
}) {
  return (
    <button type="button" onClick={() => onToggle(col)} className="flex items-center text-xs font-medium hover:text-foreground">
      {label}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ClientMatchesPage() {
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedTopicId, setSelectedTopicId] = useState<string>("");
  const [sortCol, setSortCol] = useState<SortCol>("deadlineAt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [hideDismissed, setHideDismissed] = useState(true);
  const [hideExpired, setHideExpired] = useState(true);
  const [search, setSearch] = useState("");
  const [detailMatch, setDetailMatch] = useState<ClientMatchResponse | null>(null);
  const [reportTarget, setReportTarget] = useState<Announcement | null>(null);
  const queryClient = useQueryClient();

  const clientsQuery = useQuery({
    queryKey: ["clients", 1, 200],
    queryFn: () => fetchClients(1, 200),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", selectedClientId],
    queryFn: () => fetchProjects(selectedClientId),
    enabled: !!selectedClientId,
  });

  const topicsQuery = useQuery({
    queryKey: ["topics", selectedClientId, selectedProjectId],
    queryFn: () => fetchTopics(selectedClientId, selectedProjectId),
    enabled: !!selectedClientId && !!selectedProjectId,
  });

  const matchesQuery = useQuery({
    queryKey: ["client-matches", selectedClientId],
    queryFn: () => fetchClientMatches(selectedClientId),
    enabled: !!selectedClientId,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      matchId,
      status,
    }: {
      matchId: string;
      status: "NEW" | "VIEWED" | "DISMISSED" | "SHORTLISTED";
    }) => updateMatchStatus(selectedClientId, matchId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-matches", selectedClientId] });
    },
    onError: () => toast.error("Błąd aktualizacji statusu"),
  });

  const rematchMutation = useMutation({
    mutationFn: (clientId: string) => rematchClient(clientId),
    onSuccess: (_, clientId) => {
      toast.success("Przeliczenie dopasowań zakolejkowane");
      void queryClient.invalidateQueries({ queryKey: ["client-matches", clientId] });
    },
    onError: () => toast.error("Nie udało się zakolejkować przeliczenia dopasowań"),
  });

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "similarity" ? "desc" : "asc");
    }
  }

  const allMatches = matchesQuery.data?.data ?? [];
  const projects = projectsQuery.data?.data ?? [];
  const topics = topicsQuery.data?.data ?? [];
  const clients = clientsQuery.data?.data ?? [];

  // filtered by project/topic before sorting
  const filteredByScope = useMemo(() => {
    let rows = allMatches;
    if (selectedProjectId) rows = rows.filter((m) => m.topic.projectId === selectedProjectId);
    if (selectedTopicId) rows = rows.filter((m) => m.topic.id === selectedTopicId);
    return rows;
  }, [allMatches, selectedProjectId, selectedTopicId]);

  const total = filteredByScope.length;
  const shortlisted = filteredByScope.filter((m) => m.status === "SHORTLISTED").length;
  const dismissed = filteredByScope.filter((m) => m.status === "DISMISSED").length;

  const displayedMatches = useMemo(() => {
    let rows = hideDismissed ? filteredByScope.filter((m) => m.status !== "DISMISSED") : filteredByScope;

    if (hideExpired) {
      const now = new Date();
      rows = rows.filter((m) => {
        const d = m.announcement.deadlineAt;
        if (!d) return true;
        return new Date(d) > now;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (m) =>
          m.announcement.title.toLowerCase().includes(q) ||
          (m.announcement.description ?? "").toLowerCase().includes(q),
      );
    }

    return [...rows].sort((a, b) => {
      let cmp = 0;

      if (sortCol === "deadlineAt") {
        const da = a.announcement.deadlineAt ?? "";
        const db = b.announcement.deadlineAt ?? "";
        if (!da && !db) cmp = 0;
        else if (!da) return 1;
        else if (!db) return -1;
        else cmp = da.localeCompare(db);
      } else if (sortCol === "similarity") {
        cmp = a.similarity - b.similarity;
      } else if (sortCol === "title") {
        cmp = a.announcement.title.localeCompare(b.announcement.title, "pl");
      } else if (sortCol === "publishedAt") {
        const da = a.announcement.publishedAt ?? "";
        const db = b.announcement.publishedAt ?? "";
        cmp = da.localeCompare(db);
      }

      if (cmp === 0 && sortCol !== "similarity") {
        cmp = b.similarity - a.similarity;
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredByScope, hideDismissed, hideExpired, search, sortCol, sortDir]);

  // ── Columns ─────────────────────────────────────────────────────────────────

  const columns: ColumnDef<ClientMatchResponse>[] = [
    {
      id: "title",
      header: (
        <SortHeader col="title" label="Ogłoszenie" sortCol={sortCol} sortDir={sortDir} onToggle={toggleSort} />
      ),
      cell: ({ row }) => (
        <div className="max-w-sm">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{row.announcement.title}</p>
          {row.announcement.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.announcement.description}</p>
          ) : null}
          <p className="mt-0.5 text-xs text-primary/60">
            {row.topic.projectName} › {row.topic.title}
          </p>
        </div>
      ),
    },
    {
      id: "kind",
      header: "Rodzaj",
      cell: ({ row }) => {
        const kind = row.announcement.kind;
        return kind ? (
          <Badge variant="outline" className="whitespace-nowrap text-xs">
            {KIND_LABELS[kind] ?? kind}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "llmValue",
      header: "Wartość (LLM)",
      cell: ({ row }) => {
        const val = row.announcement.llmEstimatedValue;
        if (!val) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="text-sm font-medium tabular-nums whitespace-nowrap">
            {Number(val).toLocaleString("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 })}
          </span>
        );
      },
    },
    {
      id: "deadlineAt",
      header: (
        <SortHeader col="deadlineAt" label="Termin składania" sortCol={sortCol} sortDir={sortDir} onToggle={toggleSort} />
      ),
      cell: ({ row }) => {
        const d = row.announcement.deadlineAt;
        if (!d) return <span className="text-xs text-muted-foreground">—</span>;
        const date = new Date(d);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const urgent = diffDays >= 0 && diffDays <= 3;
        const past = diffDays < 0;
        return (
          <div className="whitespace-nowrap">
            <p className={cn("text-sm font-medium", urgent && "text-yellow-600 dark:text-yellow-400", past && "text-muted-foreground line-through")}>
              {format(date, "dd.MM.yyyy", { locale: pl })}
            </p>
            <p className={cn("text-xs", urgent && "text-yellow-600 dark:text-yellow-400", past ? "text-muted-foreground" : "text-muted-foreground")}>
              {format(date, "HH:mm")}
              {past ? " · po terminie" : urgent ? ` · za ${diffDays} ${diffDays === 1 ? "dzień" : "dni"}` : ` · za ${diffDays} dni`}
            </p>
          </div>
        );
      },
    },
    {
      id: "similarity",
      header: (
        <SortHeader col="similarity" label="Dopasowanie" sortCol={sortCol} sortDir={sortDir} onToggle={toggleSort} />
      ),
      cell: ({ row }) => {
        const pct = Math.round(row.similarity * 100);
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", pct >= 70 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-muted-foreground/40")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-sm font-medium">{pct}%</span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <select
            value={row.status}
            onChange={(e) =>
              statusMutation.mutate({
                matchId: row.id,
                status: e.target.value as "NEW" | "VIEWED" | "DISMISSED" | "SHORTLISTED",
              })
            }
            className="flex h-7 rounded-lg border border-input bg-transparent px-2 py-0.5 text-xs outline-none focus-visible:border-ring"
          >
            {Object.entries(MATCH_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Szczegóły dopasowania"
            onClick={() => setDetailMatch(row)}
          >
            <Info className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Raport analityczny"
            onClick={() => {
              setReportTarget({
                id: row.announcement.id,
                title: row.announcement.title,
                detailedReport: row.announcement.detailedReport ?? null,
              } as unknown as Announcement);
            }}
          >
            <FileText className="size-3.5" />
          </Button>
          <a
            href={row.announcement.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Otwórz <ExternalLink className="size-3" />
          </a>
        </div>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-select" className="text-xs font-medium text-muted-foreground">
            Klient
          </label>
          <select
            id="client-select"
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setSelectedProjectId("");
              setSelectedTopicId("");
              setSearch("");
            }}
            className="flex h-8 min-w-[260px] rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">— wybierz klienta —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>
        </div>

        {selectedClientId && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-select" className="text-xs font-medium text-muted-foreground">
              Projekt
            </label>
            <select
              id="project-select"
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSelectedTopicId("");
              }}
              className="flex h-8 min-w-[220px] rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">— wszystkie projekty —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedClientId && selectedProjectId && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="topic-select" className="text-xs font-medium text-muted-foreground">
              Temat
            </label>
            <select
              id="topic-select"
              value={selectedTopicId}
              onChange={(e) => setSelectedTopicId(e.target.value)}
              className="flex h-8 min-w-[200px] rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">— wszystkie tematy —</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}

        {selectedClientId && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Szukaj w ogłoszeniach..."
              className="h-8 w-56 pl-8 text-sm"
            />
          </div>
        )}

        {selectedClientId && (
          <Button
            type="button"
            variant="outline"
            disabled={rematchMutation.isPending}
            onClick={() => rematchMutation.mutate(selectedClientId)}
          >
            {rematchMutation.isPending ? "Kolejkowanie…" : "Przelicz dopasowania"}
          </Button>
        )}

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
          <input type="checkbox" checked={hideDismissed} onChange={(e) => setHideDismissed(e.target.checked)} className="size-4 accent-primary" />
          Ukryj odrzucone
        </label>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
          <input type="checkbox" checked={hideExpired} onChange={(e) => setHideExpired(e.target.checked)} className="size-4 accent-primary" />
          Ukryj po terminie
        </label>
      </div>

      {/* Stats */}
      {selectedClientId && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Wszystkich dopasowań</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{total}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">łącznie w bazie</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Shortlist</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{shortlisted}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">status Wybrane</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Odrzuconych</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{dismissed}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">status Odrzucone</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={displayedMatches}
        isLoading={matchesQuery.isLoading}
        emptyState={
          !selectedClientId
            ? { title: "Wybierz klienta", description: "Wybierz klienta z listy powyżej, aby zobaczyć dopasowania." }
            : search
              ? { title: "Brak wyników", description: `Brak ogłoszeń pasujących do "${search}".` }
              : {
                  title: "Brak dopasowań",
                  description: hideDismissed
                    ? "Brak wynikow - odznacz filtr 'Ukryj odrzucone', aby zobaczyc wszystkie."
                    : "Ten klient nie ma jeszcze żadnych dopasowań. Dodaj projekt i temat, aby zacząć.",
                }
        }
      />

      <MatchDetailSheet
        match={detailMatch}
        open={!!detailMatch}
        onOpenChange={(open) => { if (!open) setDetailMatch(null); }}
      />

      <AnnouncementReportDialog
        announcement={reportTarget}
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
        allowGeneration={false}
        emptyStateMessage="Brak raportu dla tego ogłoszenia."
      />
    </div>
  );
}


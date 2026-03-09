import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, ExternalLink } from "lucide-react";
import { DataTable, type ColumnDef } from "../../../components/data-table";
import type { ClientMatchResponse } from "@leadfinder/contracts";
import { fetchClients, fetchClientMatches, updateMatchStatus } from "./clients-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

type SortCol = "title" | "similarity" | "publishedAt" | "status";
type SortDir = "asc" | "desc";

function SortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: SortCol;
  sortCol: SortCol;
  sortDir: SortDir;
}) {
  if (sortCol !== col) return <ArrowUpDown className="ml-1 inline size-3.5 opacity-40" />;
  return sortDir === "asc" ? (
    <ArrowUp className="ml-1 inline size-3.5" />
  ) : (
    <ArrowDown className="ml-1 inline size-3.5" />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ClientMatchesPage() {
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [sortCol, setSortCol] = useState<SortCol>("similarity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [hideDismissed, setHideDismissed] = useState(true);
  const queryClient = useQueryClient();

  // All clients for dropdown (high limit — admin panel never exceeds a few hundred)
  const clientsQuery = useQuery({
    queryKey: ["clients", 1, 200],
    queryFn: () => fetchClients(1, 200),
  });

  // Matches for selected client
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

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "similarity" ? "desc" : "asc");
    }
  }

  // Stats
  const allMatches = matchesQuery.data?.data ?? [];
  const total = matchesQuery.data?.meta.total ?? 0;
  const shortlisted = allMatches.filter((m) => m.status === "SHORTLISTED").length;
  const dismissed = allMatches.filter((m) => m.status === "DISMISSED").length;

  // Filtered + sorted rows
  const displayedMatches = useMemo(() => {
    const rows = hideDismissed
      ? allMatches.filter((m) => m.status !== "DISMISSED")
      : allMatches;

    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "similarity") {
        cmp = a.similarity - b.similarity;
      } else if (sortCol === "title") {
        cmp = a.announcementItem.title.localeCompare(b.announcementItem.title, "pl");
      } else if (sortCol === "publishedAt") {
        const da = a.announcementItem.announcement.publishedAt ?? "";
        const db = b.announcementItem.announcement.publishedAt ?? "";
        cmp = da.localeCompare(db);
      } else if (sortCol === "status") {
        cmp = a.status.localeCompare(b.status);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allMatches, hideDismissed, sortCol, sortDir]);

  // ── Columns ─────────────────────────────────────────────────────────────────

  const columns: ColumnDef<ClientMatchResponse>[] = [
    {
      id: "title",
      header: (
        <button
          type="button"
          onClick={() => toggleSort("title")}
          className="flex items-center text-xs font-medium hover:text-foreground"
        >
          Ogłoszenie
          <SortIcon col="title" sortCol={sortCol} sortDir={sortDir} />
        </button>
      ),
      cell: ({ row }) => (
        <div className="max-w-sm">
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {row.announcementItem.title}
          </p>
          {row.announcementItem.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {row.announcementItem.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "kind",
      header: "Rodzaj",
      cell: ({ row }) => {
        const kind = (row.announcementItem as { kind?: string | null }).kind;
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
      id: "similarity",
      header: (
        <button
          type="button"
          onClick={() => toggleSort("similarity")}
          className="flex items-center text-xs font-medium hover:text-foreground"
        >
          Dopasowanie
          <SortIcon col="similarity" sortCol={sortCol} sortDir={sortDir} />
        </button>
      ),
      cell: ({ row }) => {
        const pct = Math.round(row.similarity * 100);
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  pct >= 70
                    ? "bg-green-500"
                    : pct >= 50
                      ? "bg-yellow-500"
                      : "bg-muted-foreground/40",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-sm font-medium">{pct}%</span>
          </div>
        );
      },
    },
    {
      id: "publishedAt",
      header: (
        <button
          type="button"
          onClick={() => toggleSort("publishedAt")}
          className="flex items-center text-xs font-medium hover:text-foreground"
        >
          Opublikowano
          <SortIcon col="publishedAt" sortCol={sortCol} sortDir={sortDir} />
        </button>
      ),
      cell: ({ row }) => {
        const d = row.announcementItem.announcement.publishedAt;
        return d ? (
          <span className="text-sm">{format(new Date(d), "dd.MM.yyyy")}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "status",
      header: (
        <button
          type="button"
          onClick={() => toggleSort("status")}
          className="flex items-center text-xs font-medium hover:text-foreground"
        >
          Status
          <SortIcon col="status" sortCol={sortCol} sortDir={sortDir} />
        </button>
      ),
      cell: ({ row }) => (
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
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: "link",
      header: "",
      cell: ({ row }) => (
        <a
          href={row.announcementItem.announcement.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Otwórz
          <ExternalLink className="size-3" />
        </a>
      ),
    },
  ];

  const clients = clientsQuery.data?.data ?? [];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-6">
      {/* Toolbar: client selector + filter */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="client-select"
            className="text-xs font-medium text-muted-foreground"
          >
            Klient
          </label>
          <select
            id="client-select"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="flex h-8 min-w-[260px] rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">— wybierz klienta —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName}
              </option>
            ))}
          </select>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideDismissed}
            onChange={(e) => setHideDismissed(e.target.checked)}
            className="size-4 accent-primary"
          />
          Ukryj odrzucone
        </label>
      </div>

      {/* Stats cards — visible only after client is selected */}
      {selectedClientId && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Wszystkich dopasowań
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{total}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">łącznie w bazie</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Shortlist
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{shortlisted}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">status Wybrane</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Odrzuconych
              </CardTitle>
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
            ? {
                title: "Wybierz klienta",
                description: "Wybierz klienta z listy powyżej, aby zobaczyć dopasowania.",
              }
            : {
                title: "Brak dopasowań",
                description: hideDismissed
                  ? "Brak wynikow - odznacz filtr 'Ukryj odrzucone', aby zobaczyc wszystkie."
                  : "Ten klient nie ma jeszcze żadnych dopasowań.",
              }
        }
      />
    </div>
  );
}

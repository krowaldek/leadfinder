import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cpu, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { DataTable, type ColumnDef, type RowAction } from "../../../components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { topicsGlobalListResponseSchema, type TopicWithContext } from "@leadfinder/contracts";
import { useDebounce } from "@/lib/use-debounce";
import { embedTopic, rematchClient } from "../clients/clients-api";

const PAGE_SIZE = 20;

const EMBEDDING_STATUS_LABELS: Record<string, string> = {
  PENDING: "Oczekuje",
  EMBEDDED: "Zagnieżdżone",
  ERROR: "Błąd",
};

async function fetchAllTopics(page: number, limit: number) {
  const res = await api.get("/clients/all-topics", { params: { page, limit } });
  return topicsGlobalListResponseSchema.parse(res.data);
}

export function TopicsPage() {
  const [page, setPage] = useState(1);
  const [inputSearch, setInputSearch] = useState("");
  const debouncedSearch = useDebounce(inputSearch, 300);
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["all-topics", page, PAGE_SIZE],
    queryFn: () => fetchAllTopics(page, PAGE_SIZE),
  });

  const allData = query.data?.data ?? [];
  const filtered = useMemo(() => {
    if (!debouncedSearch) return allData;
    const q = debouncedSearch.toLowerCase();
    return allData.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.clientName.toLowerCase().includes(q) ||
        t.projectName.toLowerCase().includes(q) ||
        t.prompt.toLowerCase().includes(q),
    );
  }, [allData, debouncedSearch]);

  function togglePrompt(id: string) {
    setExpandedPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns = useMemo<ColumnDef<TopicWithContext>[]>(
    () => [
      {
        id: "title",
        header: "Temat",
        cell: ({ row }) => {
          const expanded = expandedPrompts.has(row.id);
          return (
            <div className="max-w-sm space-y-1">
              <p className="font-medium">{row.title}</p>
              {row.prompt && (
                <>
                  <p
                    className={
                      expanded
                        ? "text-xs text-muted-foreground whitespace-pre-wrap"
                        : "text-xs text-muted-foreground line-clamp-2"
                    }
                  >
                    {row.prompt}
                  </p>
                  <button
                    type="button"
                    onClick={() => togglePrompt(row.id)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {expanded ? "Zwiń" : "Pokaż pełny opis"}
                  </button>
                </>
              )}
            </div>
          );
        },
      },
      {
        id: "client",
        header: "Klient / Projekt",
        cell: ({ row }) => (
          <div>
            <Link
              to="/clients/$clientId"
              params={{ clientId: row.clientId }}
              className="text-sm font-medium hover:underline"
            >
              {row.clientName}
            </Link>
            <p className="text-xs text-muted-foreground">{row.projectName}</p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant={
              row.embeddingStatus === "EMBEDDED"
                ? "default"
                : row.embeddingStatus === "ERROR"
                  ? "destructive"
                  : "outline"
            }
          >
            {EMBEDDING_STATUS_LABELS[row.embeddingStatus] ?? row.embeddingStatus}
          </Badge>
        ),
      },
      {
        id: "matches",
        header: "Dopasowania",
        cell: ({ row }) =>
          row.matchCount > 0 ? (
            <Badge variant="secondary">{row.matchCount}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [expandedPrompts],
  );

  const rowActions = useMemo<RowAction<TopicWithContext>[]>(
    () => [
      {
        id: "embed",
        label: "Wektoryzuj",
        icon: <Cpu className="size-4" />,
        onClick: (t) => {
          embedTopic(t.clientId, t.projectId, t.id)
            .then(() => toast.success("Embedding w kolejce"))
            .catch(() => toast.error("Nie udało się zakolejkować embeddingu"));
        },
      },
      {
        id: "rematch",
        label: "Przelicz dopasowania",
        icon: <RefreshCw className="size-4" />,
        onClick: (t) => {
          rematchClient(t.clientId)
            .then(() => toast.success("Przeliczanie dopasowań zakolejkowane"))
            .catch(() => toast.error("Nie udało się zakolejkować przeliczenia"));
        },
      },
    ],
    [],
  );

  const meta = query.data?.meta;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Tematy</h1>
        <p className="text-sm text-muted-foreground">Wszystkie tematy wyszukiwania we wszystkich projektach</p>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        rowActions={rowActions}
        isLoading={query.isLoading}
        loadingMessage="Ładowanie tematów…"
        searchEnabled
        searchValue={inputSearch}
        searchPlaceholder="Szukaj tematu, klienta lub projektu…"
        onSearchChange={(v) => { setInputSearch(v); setPage(1); }}
        pagination={{
          enabled: true,
          currentPage: meta?.page ?? page,
          pageSize: meta?.limit ?? PAGE_SIZE,
          totalItems: meta?.total ?? 0,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}

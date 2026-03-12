import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DataTable, type ColumnDef } from "../../../components/data-table";
import { Badge } from "@/components/ui/badge";
import { projectsGlobalListResponseSchema, type ProjectWithClient } from "@leadfinder/contracts";
import { useDebounce } from "@/lib/use-debounce";

const PAGE_SIZE = 20;

async function fetchAllProjects(page: number, limit: number, search: string) {
  const res = await api.get("/clients/all-projects", { params: { page, limit } });
  const data = projectsGlobalListResponseSchema.parse(res.data);
  // client-side search filter (backend doesn't support search yet)
  if (search) {
    const q = search.toLowerCase();
    data.data = data.data.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }
  return data;
}

export function ProjectsPage() {
  const [page, setPage] = useState(1);
  const [inputSearch, setInputSearch] = useState("");
  const debouncedSearch = useDebounce(inputSearch, 300);

  const query = useQuery({
    queryKey: ["all-projects", page, PAGE_SIZE],
    queryFn: () => fetchAllProjects(page, PAGE_SIZE, debouncedSearch),
  });

  // Re-filter locally when search changes without refetching
  const allData = query.data?.data ?? [];
  const filtered = useMemo(() => {
    if (!debouncedSearch) return allData;
    const q = debouncedSearch.toLowerCase();
    return allData.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }, [allData, debouncedSearch]);

  const columns = useMemo<ColumnDef<ProjectWithClient>[]>(
    () => [
      {
        id: "name",
        header: "Projekt",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.name}</p>
            {row.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">{row.description}</p>
            )}
          </div>
        ),
      },
      {
        id: "client",
        header: "Klient",
        cell: ({ row }) => (
          <Link
            to="/clients/$clientId"
            params={{ clientId: row.clientId }}
            className="text-sm hover:underline"
          >
            {row.clientName}
          </Link>
        ),
      },
      {
        id: "topicCount",
        header: "Tematy",
        cell: ({ row }) => (
          <Badge variant="outline">{row.topicCount}</Badge>
        ),
      },
    ],
    [],
  );

  const meta = query.data?.meta;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Projekty</h1>
        <p className="text-sm text-muted-foreground">Wszystkie projekty we wszystkich klientach</p>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={query.isLoading}
        loadingMessage="Ładowanie projektów…"
        searchEnabled
        searchValue={inputSearch}
        searchPlaceholder="Szukaj projektu lub klienta…"
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

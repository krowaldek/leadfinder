import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  DataTable,
  type ColumnDef,
  type RowAction,
} from "../../../components/data-table";
import type { ClientResponse, ClientMatchResponse } from "@leadfinder/contracts";
import {
  fetchClients,
  fetchClientMatches,
  rematchClient,
  updateMatchStatus,
} from "./clients-api";
import { ClientEditDialog } from "../../components/ClientEditDialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PAGE_SIZE = 20;

const SCOPE_LABELS: Record<string, string> = {
  NATIONAL: "Cała Polska",
  REGIONAL: "Regionalny",
  LOCAL: "Lokalny",
};

const MATCH_STATUS_LABELS: Record<string, string> = {
  NEW: "Nowe",
  VIEWED: "Wyświetlone",
  DISMISSED: "Odrzucone",
  SHORTLISTED: "Wybrane",
};

function matchStatusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "SHORTLISTED") return "default";
  if (status === "VIEWED") return "secondary";
  if (status === "DISMISSED") return "destructive";
  return "outline";
}

// ---------------------------------------------------------------------------
// Match sheet (side panel)
// ---------------------------------------------------------------------------

function MatchesSheet({
  client,
  open,
  onClose,
}: {
  client: ClientResponse;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const matchesQuery = useQuery({
    queryKey: ["client-matches", client.id],
    queryFn: () => fetchClientMatches(client.id),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      matchId,
      status,
    }: {
      matchId: string;
      status: "NEW" | "VIEWED" | "DISMISSED" | "SHORTLISTED";
    }) => updateMatchStatus(client.id, matchId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-matches", client.id] });
    },
    onError: () => toast.error("Błąd aktualizacji statusu"),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex flex-col p-0 gap-0">
        <SheetHeader className="border-b px-6 py-4">
          <p className="text-xs font-medium text-muted-foreground">Dopasowania</p>
          <SheetTitle>{client.companyName}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {matchesQuery.isLoading && (
            <p className="text-center text-sm text-muted-foreground">Ładowanie…</p>
          )}
          {matchesQuery.isError && (
            <p className="text-center text-sm text-destructive">Błąd ładowania dopasowań</p>
          )}
          {matchesQuery.data?.data.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              Brak dopasowań dla tego klienta.
            </p>
          )}
          <div className="space-y-4">
            {matchesQuery.data?.data.map((m: ClientMatchResponse) => (
              <div key={m.id} className="rounded-lg border p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium">
                    {m.announcementItem.title}
                  </p>
                  <Badge variant={matchStatusVariant(m.status)}>
                    {MATCH_STATUS_LABELS[m.status] ?? m.status}
                  </Badge>
                </div>
                <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                  {m.announcementItem.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>
                      Podobieństwo:{" "}
                      <span className="font-medium text-foreground">
                        {(m.similarity * 100).toFixed(0)}%
                      </span>
                    </span>
                    {m.announcementItem.announcement?.url && (
                      <a
                        href={m.announcementItem.announcement.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4 hover:text-foreground"
                      >
                        Otwórz
                      </a>
                    )}
                  </div>
                  <select
                    value={m.status}
                    onChange={(e) =>
                      statusMutation.mutate({
                        matchId: m.id,
                        status: e.target.value as "NEW" | "VIEWED" | "DISMISSED" | "SHORTLISTED",
                      })
                    }
                    className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {Object.entries(MATCH_STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ClientsPage() {
  const [page, setPage] = useState(1);
  const [selectedClient, setSelectedClient] = useState<ClientResponse | null>(null);
  const [editingClient, setEditingClient] = useState<ClientResponse | null>(null);
  const queryClient = useQueryClient();

  const clientsQuery = useQuery({
    queryKey: ["clients", page, PAGE_SIZE],
    queryFn: () => fetchClients(page, PAGE_SIZE),
  });

  const rematchMutation = useMutation({
    mutationFn: rematchClient,
    onSuccess: () => toast.success("Ponowne dopasowanie zostało zakolejkowane"),
    onError: () => toast.error("Błąd kolejkowania"),
  });

  const columns = useMemo<ColumnDef<ClientResponse>[]>(
    () => [
      {
        id: "companyName",
        header: "Firma",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.companyName}</p>
            <p className="text-xs text-muted-foreground">
              {row.contactPersonName} · {row.contactPersonRole}
            </p>
          </div>
        ),
      },
      {
        id: "industry",
        header: "Branża",
        cell: ({ row }) => <span className="text-sm">{row.industry}</span>,
      },
      {
        id: "geographicScope",
        header: "Zasięg",
        cell: ({ row }) => (
          <div>
            <Badge variant="outline">
              {SCOPE_LABELS[row.geographicScope] ?? row.geographicScope}
            </Badge>
            {row.geographicDetails && (
              <p className="mt-1 text-xs text-muted-foreground">{row.geographicDetails}</p>
            )}
          </div>
        ),
      },
      {
        id: "matchCount",
        header: "Dopasowania",
        cell: ({ row }) => (
          <span className="font-mono text-sm font-medium">{row.matchCount}</span>
        ),
      },
      {
        id: "createdAt",
        header: "Dodano",
        accessorFn: (row) => format(new Date(row.createdAt), "dd.MM.yyyy"),
      },
    ],
    [],
  );

  const rowActions = useMemo<RowAction<ClientResponse>[]>(
    () => [
      {
        id: "matches",
        label: "Dopasowania",
        onClick: (row) => setSelectedClient(row),
      },
      {
        id: "edit",
        label: "Edytuj",
        onClick: (row) => setEditingClient(row),
      },
      {
        id: "rematch",
        label: "Przelicz",
        onClick: (row) => rematchMutation.mutate(row.id),
      },
    ],
    [rematchMutation],
  );

  const data = clientsQuery.data?.data ?? [];
  const meta = clientsQuery.data?.meta;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Klientów ogółem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{meta?.total ?? "—"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">w bazie</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aktywnych
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{meta?.total ?? "—"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">status ACTIVE</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Strona
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {page} / {meta?.totalPages ?? "?"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">limit {PAGE_SIZE}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Link to="/clients/prompt" className={buttonVariants()}>
          + Dodaj klienta (AI)
        </Link>
      </div>

      <DataTable
        columns={columns}
        data={data}
        isLoading={clientsQuery.isLoading}
        rowActions={rowActions}
        pagination={{
          enabled: true,
          currentPage: page,
          pageSize: PAGE_SIZE,
          totalItems: meta?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "Brak klientów",
          description: "Dodaj pierwszego klienta przez AI.",
        }}
      />

      {selectedClient && (
        <MatchesSheet
          client={selectedClient}
          open={!!selectedClient}
          onClose={() => {
            setSelectedClient(null);
            void queryClient.invalidateQueries({ queryKey: ["clients"] });
          }}
        />
      )}

      <ClientEditDialog
        key={editingClient?.id ?? ""}
        open={!!editingClient}
        client={editingClient}
        onOpenChange={(open) => {
          if (!open) setEditingClient(null);
        }}
      />
    </div>
  );
}


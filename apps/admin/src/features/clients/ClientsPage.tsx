import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  DataTable,
  type ColumnDef,
  type RowAction,
} from "../../../components/data-table";
import type { ClientResponse } from "@leadfinder/contracts";
import {
  fetchClients,
  updateClient,
} from "./clients-api";
import { ClientEditDialog } from "../../components/ClientEditDialog";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ClientsPage() {
  const [page, setPage] = useState(1);
  const [editingClient, setEditingClient] = useState<ClientResponse | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const queryClient = useQueryClient();

  const clientsQuery = useQuery({
    queryKey: ["clients", page, PAGE_SIZE],
    queryFn: () => fetchClients(page, PAGE_SIZE),
  });

  const columns = useMemo<ColumnDef<ClientResponse>[]>(
    () => [
      {
        id: "companyName",
        header: "Firma",
        cell: ({ row }) => (
          <div>
            <Link
              to="/clients/$clientId"
              params={{ clientId: row.id }}
              className="font-medium hover:underline"
            >
              {row.companyName}
            </Link>
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
        id: "projectCount",
        header: "Projekty",
        cell: ({ row }) => (
          <span className="font-mono text-sm font-medium">{row.projectCount}</span>
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
        id: "edit",
        label: "Edytuj",
        onClick: (row) => setEditingClient(row),
      },
    ],
    [],
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
        <Button onClick={() => setOnboardOpen(true)}>
          + Dodaj klienta (AI)
        </Button>
      </div>

      <OnboardingDialog open={onboardOpen} onOpenChange={setOnboardOpen} />

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


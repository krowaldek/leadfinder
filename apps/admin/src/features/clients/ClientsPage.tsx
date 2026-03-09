import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
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

const PAGE_SIZE = 20;

const SCOPE_LABELS: Record<string, string> = {
  NATIONAL: "Cała Polska",
  REGIONAL: "Regionalny",
  LOCAL: "Lokalny",
};

const SCOPE_CLASS: Record<string, string> = {
  NATIONAL:
    "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-300",
  REGIONAL:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300",
  LOCAL:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
};

const MATCH_STATUS_LABELS: Record<string, string> = {
  NEW: "Nowe",
  VIEWED: "Wyświetlone",
  DISMISSED: "Odrzucone",
  SHORTLISTED: "Wybrane",
};

const MATCH_STATUS_CLASS: Record<string, string> = {
  NEW: "bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300",
  VIEWED:
    "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-300",
  DISMISSED:
    "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-300",
  SHORTLISTED:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300",
};

function Tag({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Match drawer
// ---------------------------------------------------------------------------

function MatchesDrawer({
  client,
  onClose,
}: {
  client: ClientResponse;
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
      void queryClient.invalidateQueries({
        queryKey: ["client-matches", client.id],
      });
    },
    onError: () => toast.error("Błąd aktualizacji statusu"),
  });

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="relative ml-auto flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-stone-900"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 dark:border-stone-700">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-500 dark:text-stone-400">
              Dopasowania
            </p>
            <h3 className="mt-0.5 text-lg font-semibold text-stone-900 dark:text-stone-100">
              {client.companyName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-200 p-2 text-stone-500 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {matchesQuery.isLoading && (
            <p className="text-center text-sm text-stone-500">Ładowanie…</p>
          )}
          {matchesQuery.isError && (
            <p className="text-center text-sm text-red-500">
              Błąd ładowania dopasowań
            </p>
          )}
          {matchesQuery.data?.data.length === 0 && (
            <p className="text-center text-sm text-stone-500">
              Brak dopasowań dla tego klienta.
            </p>
          )}
          <div className="space-y-4">
            {matchesQuery.data?.data.map((m: ClientMatchResponse) => (
              <div
                key={m.id}
                className="rounded-2xl border border-stone-200 p-4 dark:border-stone-700"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100 line-clamp-2">
                    {m.announcementItem.title}
                  </p>
                  <Tag className={MATCH_STATUS_CLASS[m.status]}>
                    {MATCH_STATUS_LABELS[m.status] ?? m.status}
                  </Tag>
                </div>
                <p className="mb-3 text-xs text-stone-500 dark:text-stone-400 line-clamp-2">
                  {m.announcementItem.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2 text-xs text-stone-400">
                    <span>
                      Podobieństwo:{" "}
                      <span className="font-medium text-amber-600">
                        {(m.similarity * 100).toFixed(0)}%
                      </span>
                    </span>
                    {m.announcementItem.announcement?.url && (
                      <a
                        href={m.announcementItem.announcement.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-amber-600"
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
                    className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
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
      </motion.div>
    </div>
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
            <p className="font-medium text-stone-900 dark:text-stone-100">
              {row.companyName}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {row.contactPersonName} · {row.contactPersonRole}
            </p>
          </div>
        ),
      },
      {
        id: "industry",
        header: "Branża",
        cell: ({ row }) => (
          <span className="text-sm text-stone-700 dark:text-stone-300">
            {row.industry}
          </span>
        ),
      },
      {
        id: "geographicScope",
        header: "Zasięg",
        cell: ({ row }) => (
          <div>
            <Tag className={SCOPE_CLASS[row.geographicScope]}>
              {SCOPE_LABELS[row.geographicScope] ?? row.geographicScope}
            </Tag>
            {row.geographicDetails && (
              <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                {row.geographicDetails}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "matchCount",
        header: "Dopasowania",
        cell: ({ row }) => (
          <span className="font-mono text-sm font-medium text-amber-700 dark:text-amber-400">
            {row.matchCount}
          </span>
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
    <div>
      {/* stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Klientów ogółem"
          value={meta?.total ?? "—"}
          sub="w bazie"
        />
        <StatCard
          label="Aktywnych"
          value={meta?.total ?? "—"}
          sub="status ACTIVE"
        />
        <StatCard
          label="Strona"
          value={`${page} / ${meta?.totalPages ?? "?"}`}
          sub={`limit ${PAGE_SIZE}`}
        />
      </div>

      {/* CTA */}
      <div className="mb-4 flex justify-end">
        <Link
          to="/clients/prompt"
          className="rounded-full bg-amber-500 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-600"
        >
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
        <MatchesDrawer
          client={selectedClient}
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

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/60 px-5 py-4 dark:border-stone-700 dark:bg-stone-800/40">
      <p className="text-xs uppercase tracking-widest text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p className="mt-1 font-[Cormorant_Garamond] text-3xl font-semibold text-stone-900 dark:text-stone-100">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{sub}</p>
    </div>
  );
}

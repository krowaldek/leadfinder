import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
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
import { fetchAnnouncements } from "./announcements-api";
import {
  RawDataDialog,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/components/RawDataDialog";

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

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

const STATUS_BADGE_CLASS: Record<AnnouncementStatus, string> = {
  OPEN: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300",
  CLOSED: "bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300",
  AWARDED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
  UNKNOWN: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
};

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

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
        "inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs transition",
        active
          ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-300"
          : "border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-700 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-200",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AnnouncementsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<AnnouncementSource | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<AnnouncementStatus | "ALL">("ALL");
  const [selected, setSelected] = useState<Announcement | null>(null);

  const query = useQuery({
    queryKey: [
      "announcements",
      search,
      page,
      PAGE_SIZE,
      sourceFilter,
      statusFilter,
    ],
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
            <div className="line-clamp-2 font-medium text-stone-950 dark:text-stone-100">
              {row.title}
            </div>
            {row.description && (
              <div className="mt-1 line-clamp-1 text-xs text-stone-500">
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
          <Tag className="bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {SOURCE_LABELS[row.sourceSystem]}
          </Tag>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (a) => a.status,
        cell: ({ row }) => (
          <Tag className={STATUS_BADGE_CLASS[row.status]}>
            {STATUS_LABELS[row.status]}
          </Tag>
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
                new Date(row.deadlineAt) < new Date()
                  ? "text-stone-400"
                  : "text-stone-800 dark:text-stone-200",
              )}
            >
              {format(new Date(row.deadlineAt), "dd.MM.yyyy")}
            </span>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      {
        id: "value",
        header: "Wartość",
        accessorFn: (a) => a.valueMin,
        cell: ({ row }) => {
          if (!row.valueMin && !row.valueMax) return <span className="text-stone-400">—</span>;
          const fmt = (v: string) =>
            Number(v).toLocaleString("pl-PL", {
              style: "currency",
              currency: "PLN",
              maximumFractionDigits: 0,
            });
          if (row.valueMin && row.valueMax && row.valueMin !== row.valueMax) {
            return (
              <span className="text-sm text-stone-700 dark:text-stone-300">
                {fmt(row.valueMin)} – {fmt(row.valueMax)}
              </span>
            );
          }
          return (
            <span className="text-sm text-stone-700 dark:text-stone-300">
              {fmt((row.valueMin ?? row.valueMax)!)}
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
        id: "open",
        label: "Otwórz w źródle",
        onClick: (a) => window.open(a.url, "_blank", "noreferrer"),
      },
    ],
    [],
  );

  return (
    <div className="grid gap-6">
      {/* Header card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-[2rem] border border-stone-900/10 bg-[#fcfaf6] p-6 dark:border-stone-700/60 dark:bg-stone-800/60"
      >
        <p className="text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
          Ogłoszenia
        </p>
        <h3 className="mt-4 max-w-2xl font-[Cormorant_Garamond] text-4xl font-semibold text-stone-950 dark:text-stone-100">
          Zapytania ofertowe pobrane z zewnętrznych portali.
        </h3>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600 dark:text-stone-400">
          Przeglądaj i filtruj ogłoszenia ze wszystkich skonfigurowanych źródeł.
          Kliknij na wiersz, aby zobaczyć pełne dane z parsera.
        </p>
        {meta && (
          <p className="mt-3 text-xs text-stone-400">
            Łącznie w bazie:{" "}
            <span className="font-semibold text-stone-600 dark:text-stone-300">
              {meta.total.toLocaleString("pl-PL")}
            </span>{" "}
            ogłoszeń
          </p>
        )}
      </motion.div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_OPTIONS.map((opt) => (
            <FilterButton
              key={opt.value}
              active={sourceFilter === opt.value}
              onClick={() => {
                setSourceFilter(opt.value);
                setPage(1);
              }}
            >
              {opt.label}
            </FilterButton>
          ))}
        </div>
        <div className="h-auto w-px bg-stone-200 dark:bg-stone-700 self-stretch hidden sm:block" />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <FilterButton
              key={opt.value}
              active={statusFilter === opt.value}
              onClick={() => {
                setStatusFilter(opt.value);
                setPage(1);
              }}
            >
              {opt.label}
            </FilterButton>
          ))}
        </div>
      </div>

      {/* Table */}
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

      {/* JSON preview dialog */}
      <RawDataDialog
        announcement={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

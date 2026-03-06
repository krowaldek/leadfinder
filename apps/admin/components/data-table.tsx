import { type ReactNode, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";

export interface ColumnDef<T> {
  id: string;
  header: string | ReactNode;
  accessorKey?: Extract<keyof T, string>;
  accessorFn?: (row: T) => unknown;
  cell?: (props: { row: T; value: unknown }) => ReactNode;
  width?: string;
  headerAlign?: "left" | "center" | "right";
  cellAlign?: "left" | "center" | "right";
}

export interface RowAction<T> {
  id: string;
  label: string;
  onClick: (row: T) => void;
  variant?: "default" | "danger";
  disabled?: (row: T) => boolean;
  hidden?: (row: T) => boolean;
}

export interface DataTableProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef<T>[];
  isLoading?: boolean;
  loadingMessage?: string;

  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;

  addButton?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };

  rowActions?: RowAction<T>[];

  pagination?: {
    enabled: boolean;
    currentPage: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
  };

  emptyState?: {
    title?: string;
    description?: string;
    action?: {
      label: string;
      onClick: () => void;
    };
  };

  className?: string;
}

function getAlignClass(align: "left" | "center" | "right" | undefined) {
  if (align === "center") {
    return "text-center";
  }

  if (align === "right") {
    return "text-right";
  }

  return "text-left";
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  isLoading = false,
  loadingMessage = "Ladowanie danych...",
  searchEnabled = false,
  searchPlaceholder = "Szukaj...",
  searchValue,
  onSearchChange,
  addButton,
  rowActions,
  pagination,
  emptyState,
  className,
}: DataTableProps<T>) {
  const totalPages = pagination?.enabled
    ? Math.max(1, Math.ceil(pagination.totalItems / pagination.pageSize))
    : 1;

  const pageNumbers = useMemo(() => {
    if (!pagination?.enabled) {
      return [];
    }

    const pages = new Set<number>();
    pages.add(1);
    pages.add(totalPages);

    for (
      let page = Math.max(1, pagination.currentPage - 1);
      page <= Math.min(totalPages, pagination.currentPage + 1);
      page += 1
    ) {
      pages.add(page);
    }

    return Array.from(pages).sort((a, b) => a - b);
  }, [pagination, totalPages]);

  const hasRows = data.length > 0;

  return (
    <section
      className={`min-w-0 w-full rounded-[2rem] border border-stone-900/10 bg-white/90 p-5 shadow-[0_16px_50px_rgba(80,56,21,0.08)] dark:border-stone-700/60 dark:bg-stone-900/80 dark:shadow-[0_16px_50px_rgba(0,0,0,0.3)] ${className ?? ""}`}
    >
      {(searchEnabled || addButton) && (
        <div className="flex flex-col gap-4 border-b border-stone-900/10 pb-5 md:flex-row md:items-center md:justify-between dark:border-stone-700/60">
          {searchEnabled ? (
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={searchValue ?? ""}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-h-12 w-full rounded-full border border-stone-900/10 bg-[#faf7f1] pl-11 pr-4 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-amber-600 dark:focus:ring-amber-900/50"
              />
            </div>
          ) : (
            <div />
          )}

          {addButton ? (
            <button
              type="button"
              onClick={addButton.onClick}
              disabled={addButton.disabled}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-700 dark:hover:bg-amber-600"
            >
              <Plus className="h-4 w-4" />
              {addButton.label}
            </button>
          ) : null}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-stone-900/10 dark:border-stone-700/60">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-stone-950 text-xs uppercase tracking-[0.22em] text-stone-300 dark:bg-stone-800">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    className={`px-5 py-4 font-medium ${getAlignClass(column.headerAlign)}`}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    {column.header}
                  </th>
                ))}
                {rowActions && rowActions.length > 0 ? (
                  <th className="px-5 py-4 text-right font-medium">Akcje</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={columns.length + (rowActions?.length ? 1 : 0)}
                    className="px-5 py-8 text-center text-stone-500 dark:text-stone-400"
                  >
                    {loadingMessage}
                  </td>
                </tr>
              ) : !hasRows ? (
                <tr>
                  <td
                    colSpan={columns.length + (rowActions?.length ? 1 : 0)}
                    className="px-5 py-10 text-center"
                  >
                    <p className="font-medium text-stone-900 dark:text-stone-100">
                      {emptyState?.title ?? "Brak danych do wyswietlenia."}
                    </p>
                    {emptyState?.description ? (
                      <p className="mt-2 text-sm text-stone-600">
                        {emptyState.description}
                      </p>
                    ) : null}
                    {emptyState?.action ? (
                      <button
                        type="button"
                        onClick={emptyState.action.onClick}
                        className="mt-4 rounded-full border border-stone-900/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-stone-700 transition hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                      >
                        {emptyState.action.label}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const visibleActions = (rowActions ?? []).filter(
                    (action) => !action.hidden || !action.hidden(row),
                  );

                  return (
                    <tr
                      key={row.id}
                      className="border-t border-stone-900/6 bg-white even:bg-[#fcfaf6] dark:border-stone-700/40 dark:bg-stone-900 dark:even:bg-stone-800/60"
                    >
                      {columns.map((column) => {
                        const value = column.accessorFn
                          ? column.accessorFn(row)
                          : column.accessorKey
                            ? (row[column.accessorKey] as unknown)
                            : undefined;

                        return (
                          <td
                            key={column.id}
                            className={`px-5 py-4 align-top text-stone-700 dark:text-stone-300 ${getAlignClass(column.cellAlign)}`}
                          >
                            {column.cell
                              ? column.cell({ row, value })
                              : (value as ReactNode)}
                          </td>
                        );
                      })}

                      {rowActions && rowActions.length > 0 ? (
                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            {visibleActions.map((action) => {
                              const disabled = action.disabled?.(row) ?? false;
                              const isDanger = action.variant === "danger";
                              return (
                                <button
                                  key={action.id}
                                  type="button"
                                  onClick={() => action.onClick(row)}
                                  disabled={disabled}
                                  className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    isDanger
                                      ? "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                      : "border-stone-900/10 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                                  }`}
                                >
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination?.enabled ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-stone-900/10 pt-4 text-sm text-stone-600 md:flex-row md:items-center md:justify-between dark:border-stone-700/60 dark:text-stone-400">
          <p>
            Strona {pagination.currentPage} z {totalPages} • Rekordy:{" "}
            {pagination.totalItems}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                pagination.onPageChange(Math.max(1, pagination.currentPage - 1))
              }
              disabled={pagination.currentPage <= 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-900/10 text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => pagination.onPageChange(pageNumber)}
                className={`h-9 min-w-9 rounded-full border px-3 text-xs font-medium ${
                  pageNumber === pagination.currentPage
                    ? "border-stone-900 bg-stone-900 text-white dark:border-amber-600 dark:bg-amber-700"
                    : "border-stone-900/10 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                }`}
              >
                {pageNumber}
              </button>
            ))}

            <button
              type="button"
              onClick={() =>
                pagination.onPageChange(
                  Math.min(totalPages, pagination.currentPage + 1),
                )
              }
              disabled={pagination.currentPage >= totalPages}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-900/10 text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

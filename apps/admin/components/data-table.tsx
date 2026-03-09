import { type ReactNode, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

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
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  isLoading = false,
  loadingMessage = "Ładowanie danych...",
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
    if (!pagination?.enabled) return [];
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
    <div className={cn("w-full min-w-0 space-y-4", className)}>
      {(searchEnabled || addButton) && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {searchEnabled ? (
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
              />
            </div>
          ) : (
            <div />
          )}

          {addButton && (
            <Button
              onClick={addButton.onClick}
              disabled={addButton.disabled}
            >
              <Plus className="size-4" />
              {addButton.label}
            </Button>
          )}
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={getAlignClass(column.headerAlign)}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </TableHead>
              ))}
              {rowActions && rowActions.length > 0 && (
                <TableHead className="text-right">Akcje</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (rowActions?.length ? 1 : 0)}
                  className="py-8 text-center text-muted-foreground"
                >
                  {loadingMessage}
                </TableCell>
              </TableRow>
            ) : !hasRows ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (rowActions?.length ? 1 : 0)}
                  className="py-10 text-center"
                >
                  <p className="font-medium">
                    {emptyState?.title ?? "Brak danych do wyświetlenia."}
                  </p>
                  {emptyState?.description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {emptyState.description}
                    </p>
                  )}
                  {emptyState?.action && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={emptyState.action.onClick}
                    >
                      {emptyState.action.label}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => {
                const visibleActions = (rowActions ?? []).filter(
                  (action) => !action.hidden || !action.hidden(row),
                );

                return (
                  <TableRow key={row.id}>
                    {columns.map((column) => {
                      const value = column.accessorFn
                        ? column.accessorFn(row)
                        : column.accessorKey
                          ? (row[column.accessorKey] as unknown)
                          : undefined;

                      return (
                        <TableCell
                          key={column.id}
                          className={cn("align-top", getAlignClass(column.cellAlign))}
                        >
                          {column.cell ? column.cell({ row, value }) : (value as ReactNode)}
                        </TableCell>
                      );
                    })}

                    {rowActions && rowActions.length > 0 && (
                      <TableCell className="align-top text-right">
                        <div className="flex justify-end gap-2">
                          {visibleActions.map((action) => {
                            const disabled = action.disabled?.(row) ?? false;
                            return (
                              <Button
                                key={action.id}
                                variant={action.variant === "danger" ? "destructive" : "outline"}
                                size="xs"
                                onClick={() => action.onClick(row)}
                                disabled={disabled}
                              >
                                {action.label}
                              </Button>
                            );
                          })}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {pagination?.enabled && (
        <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>
            Strona {pagination.currentPage} z {totalPages} &bull; Rekordy:{" "}
            {pagination.totalItems}
          </p>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => pagination.onPageChange(Math.max(1, pagination.currentPage - 1))}
              disabled={pagination.currentPage <= 1}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {pageNumbers.map((pageNumber) => (
              <Button
                key={pageNumber}
                variant={pageNumber === pagination.currentPage ? "default" : "outline"}
                size="xs"
                onClick={() => pagination.onPageChange(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() =>
                pagination.onPageChange(Math.min(totalPages, pagination.currentPage + 1))
              }
              disabled={pagination.currentPage >= totalPages}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}


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


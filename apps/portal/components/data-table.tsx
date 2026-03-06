import { PermissionGuard } from "@/components/auth/PermissionGuard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useDataTableExport } from '@/hooks/data/use-exports';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    flexRender,
    getCoreRowModel,
    getExpandedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnFiltersState,
    type ExpandedState,
    type PaginationState,
    type Row,
    type RowSelectionState,
    type SortingState,
    type ColumnDef as TanStackColumnDef,
    type Table as TanStackTable,
    type VisibilityState,
} from "@tanstack/react-table";
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ChevronUp,
    Download,
    FileSpreadsheet,
    FileText,
    Filter,
    Loader2,
    MoreVertical,
    Plus,
    RefreshCw,
    Search,
} from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export type SortDirection = "asc" | "desc" | null;

export interface ColumnDef<T> {
  /** Unique identifier for the column */
  id: string;
  /** Header label */
  header: string | React.ReactNode;
  /** Accessor function to get cell value */
  accessorFn?: (row: T) => any;
  /** Accessor key (alternative to accessorFn) */
  accessorKey?: keyof T;
  /** Custom cell renderer */
  cell?: (props: {
    row: T;
    value: any;
    isExpanded?: boolean;
    toggleExpand?: () => void;
  }) => React.ReactNode;
  /** Enable sorting for this column */
  sortable?: boolean;
  /** Column width (CSS value) */
  width?: string;
  /** Minimum column width (CSS value) */
  minWidth?: string;
  /** Maximum column width (CSS value) */
  maxWidth?: string;
  /** Header alignment */
  headerAlign?: "left" | "center" | "right";
  /** Cell alignment */
  cellAlign?: "left" | "center" | "right";
  /** Enable filtering for this column */
  filterable?: boolean;
  /** Filter options for dropdown filter */
  filterOptions?: Array<{ label: string; value: string }>;
  /** Custom filter function */
  filterFn?: (row: T, filterValue: any) => boolean;
  /** Hide column by default */
  hidden?: boolean;
}

export interface FilterConfig {
  id: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  defaultValue?: string;
  /**
   * If true, this filter is "virtual" (external) and does not need a matching TanStack column id.
   * The value will be managed externally and propagated via `onFilterChange`.
   */
  virtual?: boolean;
  /**
   * Controlled value for virtual filters.
   * If provided, DataTable will display it as selected and use it to show the current label.
   */
  value?: string;
}

export interface BulkAction<T> {
  id: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  onClick: (selectedRows: T[]) => void;
  /** Permission code required */
  permission?: string;
}

export interface RowAction<T> {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  variant?: "default" | "destructive";
  /** Hide action conditionally */
  hidden?: (row: T) => boolean;
  /** Permission code required */
  permission?: string;
}

export interface ExportConfig {
  enabled: boolean
  formats?: Array<'XLSX' | 'CSV' | 'PDF' | 'xlsx' | 'csv' | 'pdf'>
  /** Resource name for backend export (e.g., 'users', 'positions') */
  resource?: string
  /**
   * Optional: Custom columns for export (id, header).
   * If not provided, all table columns will be exported.
   * Use this to control which columns appear in export and their order.
   */
  columns?: Array<{ id: string; header?: string; accessor?: string }>
  /** Legacy callback for custom export logic (deprecated - use resource instead) */
  onExport?: (format: string, data: any[]) => void
}

/** Table state for URL synchronization */
export interface DataTableState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  pagination: PaginationState;
  rowSelection: RowSelectionState;
  expanded: ExpandedState;
  columnVisibility: VisibilityState;
}

/** Adapter interface for URL state synchronization */
export interface DataTableStateAdapter {
  /** Get current state from URL/external source */
  getState: () => Partial<DataTableState>;
  /** Update URL/external source with new state */
  setState: (state: Partial<DataTableState>) => void;
  /** Subscribe to external state changes */
  subscribe?: (
    callback: (state: Partial<DataTableState>) => void,
  ) => () => void;
}

export interface DataTableProps<T extends { id: string }> {
  // Data
  data: T[];
  columns: ColumnDef<T>[];

  // Header
  title?: string;
  description?: string;

  // Loading
  isLoading?: boolean;
  loadingMessage?: string;

  // Search
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  onSearchChange?: (query: string) => void;
  /** Enable manual (server-side) global search - disables client-side global filter */
  manualGlobalFilter?: boolean;

  // Filters
  filters?: FilterConfig[];
  onFilterChange?: (filterId: string, value: string) => void;
  /** Enable manual (server-side) filtering - disables client-side column filters */
  manualFiltering?: boolean;

  // Sorting
  defaultSort?: { id: string; direction: SortDirection };
  onSortChange?: (id: string, direction: SortDirection) => void;
  /** Enable manual (server-side) sorting - disables client-side sorting */
  manualSorting?: boolean;

  // Selection
  selectionEnabled?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;

  // Bulk Actions
  bulkActions?: BulkAction<T>[];

  // Row Actions
  rowActions?: RowAction<T>[];

  // Row Click
  onRowClick?: (row: T) => void;

  /** Key for saving state (pageSize, etc.) to localStorage */
  storageKey?: string;

  // Global Action (shown when nothing is selected)
  globalAction?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };

  // Add button
  addButton?: {
    label: string;
    onClick: () => void;
    permission?: string;
    icon?: React.ReactNode;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
    disabled?: boolean;
  };

  // Refresh
  refreshEnabled?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;

  // Export
  export?: ExportConfig;

  // Pagination
  pagination?: {
    enabled: boolean;
    pageSize?: number;
    pageSizeOptions?: number[];
    currentPage?: number;
    totalItems?: number;
    onPageChange?: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  };

  // Empty state
  emptyState?: {
    title?: string;
    description?: string;
    icon?: React.ReactNode;
    action?: {
      label: string;
      onClick: () => void;
    };
  };

  // Expandable rows
  expandable?: {
    /** Render function for expanded content */
    renderExpanded: (row: T) => React.ReactNode;
    /** Check if row can be expanded */
    canExpand?: (row: T) => boolean;
    /** Allow multiple rows to be expanded at once */
    allowMultiple?: boolean;
    /** Default expanded row IDs */
    defaultExpanded?: string[];
  };

  // URL State Adapter
  stateAdapter?: DataTableStateAdapter;

  // Custom toolbar content
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;

  // Styling
  className?: string;
  tableClassName?: string;
  stickyHeader?: boolean;

  // Callbacks
  onStateChange?: (state: DataTableState) => void;
}

const EMPTY_FILTERS: FilterConfig[] = [];
const EMPTY_BULK_ACTIONS: BulkAction<never>[] = [];
const EMPTY_ROW_ACTIONS: RowAction<never>[] = [];

// ============================================================================
// Helper Components
// ============================================================================

function SortIcon({ direction }: { direction: SortDirection }) {
  if (direction === "asc") return <ArrowUp className="h-4 w-4" />;
  if (direction === "desc") return <ArrowDown className="h-4 w-4" />;
  return <ArrowUpDown className="h-4 w-4 opacity-50" />;
}

function ExportMenu({
  formats = ['XLSX', 'CSV', 'PDF'],
  onExport,
  isExporting = false,
}: {
  formats: Array<'XLSX' | 'CSV' | 'PDF' | 'xlsx' | 'csv' | 'pdf'>
  onExport: (format: string) => void
  isExporting?: boolean
}) {
  const formatConfig = {
    XLSX: { label: 'Excel (.xlsx)', icon: FileSpreadsheet },
    CSV: { label: 'CSV (.csv)', icon: FileText },
    PDF: { label: 'PDF (.pdf)', icon: FileText },
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {isExporting ? 'Eksportuję…' : 'Eksportuj'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {formats.map((format) => {
          // Normalize format to uppercase for config lookup
          const normalizedFormat = format.toUpperCase() as 'XLSX' | 'CSV' | 'PDF'
          const config = formatConfig[normalizedFormat]
          const Icon = config.icon
          return (
            <DropdownMenuItem
              key={format}
              disabled={isExporting}
              onClick={() => onExport(normalizedFormat)}
            >
              <Icon className="mr-2 h-4 w-4" />
              <span>{config.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExpandedRowContent({
  content,
}: {
  content: React.ReactNode;
}) {
  return <div className="p-4 border-t border-b border-muted">{content}</div>;
}

function ExpandButton({
  isExpanded,
  onClick,
}: {
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {isExpanded ? (
        <ChevronUp className="h-4 w-4" />
      ) : (
        <ChevronDown className="h-4 w-4" />
      )}
    </Button>
  );
}

// ============================================================================
// URL State Adapter for TanStack Router
// ============================================================================

export function createTanStackRouterAdapter<TSearch extends object>(
  navigate: (opts: { search: (prev: TSearch) => TSearch }) => void,
  search: TSearch,
): DataTableStateAdapter {
  const searchRecord = search as Record<string, unknown>

  const extractFilterValue = (raw: unknown): unknown => {
    if (
      raw &&
      typeof raw === 'object' &&
      'op' in raw &&
      'value' in raw
    ) {
      return (raw as { value: unknown }).value
    }
    return raw
  }

  return {
    getState: () => {
      const state: Partial<DataTableState> = {}

      // Parse sorting from URL
      if (searchRecord.sortBy) {
        state.sorting = [
          {
            id: String(searchRecord.sortBy),
            desc: searchRecord.sortOrder === 'desc',
          },
        ]
      }

      // Parse pagination from URL
      if (searchRecord.page !== undefined || searchRecord.limit !== undefined) {
        const page = typeof searchRecord.page === 'number' ? searchRecord.page : Number(searchRecord.page)
        const limit = typeof searchRecord.limit === 'number' ? searchRecord.limit : Number(searchRecord.limit)
        state.pagination = {
          pageIndex: Number.isFinite(page) && page > 0 ? page - 1 : 0,
          pageSize: Number.isFinite(limit) && limit > 0 ? limit : 10,
        }
      }

      // Parse global filter from URL
      if (typeof searchRecord.search === 'string' && searchRecord.search.length > 0) {
        state.globalFilter = searchRecord.search;
      }

      // Parse column filters from URL
      // Supports both:
      // - legacy shape: { [id]: value }
      // - listing API shape: { [id]: { op, value, mode? } }
      if (searchRecord.filters) {
        try {
          const filters =
            typeof searchRecord.filters === 'string'
              ? JSON.parse(searchRecord.filters)
              : searchRecord.filters

          if (filters && typeof filters === 'object') {
            state.columnFilters = Object.entries(filters).map(([id, raw]) => ({
              id,
              value: extractFilterValue(raw),
            }))
          }
        } catch {
          // Invalid filters format
        }
      }

      // Parse expanded from URL
      if (searchRecord.expanded) {
        try {
          const expanded =
            typeof searchRecord.expanded === 'string'
              ? JSON.parse(searchRecord.expanded)
              : searchRecord.expanded
          if (Array.isArray(expanded)) {
            state.expanded = expanded.reduce(
              (acc, id) => {
                if (typeof id === 'string') {
                  acc[id] = true
                }
                return acc
              },
              {} as Record<string, boolean>,
            )
          }
        } catch {
          // Invalid expanded format
        }
      }

      return state
    },

    setState: (newState) => {
      navigate({
        search: (prev) => {
          const updates: Record<string, unknown> = { ...(prev as Record<string, unknown>) }

          // Update sorting
          if (newState.sorting !== undefined) {
            if (newState.sorting.length > 0) {
              updates.sortBy = newState.sorting[0].id
              updates.sortOrder = newState.sorting[0].desc ? 'desc' : 'asc'
            } else {
              delete updates.sortBy
              delete updates.sortOrder
            }
          }

          // Update pagination
          if (newState.pagination !== undefined) {
            updates.page = newState.pagination.pageIndex + 1
            updates.limit = newState.pagination.pageSize
          }

          // Update global filter
          if (newState.globalFilter !== undefined) {
            if (newState.globalFilter) {
              updates.search = newState.globalFilter
            } else {
              delete updates.search
            }
          }

          // Update column filters
          // Encode filters in a shape compatible with backend listing API:
          // { [id]: { op, value, mode? } }
          if (newState.columnFilters !== undefined) {
            if (newState.columnFilters.length > 0) {
              const filters = newState.columnFilters.reduce(
                (acc, filter) => {
                  const v = filter.value

                  // Skip empty values to avoid sending meaningless filters
                  if (
                    v === undefined ||
                    v === null ||
                    (typeof v === 'string' && v.trim() === '') ||
                    (Array.isArray(v) && v.length === 0)
                  ) {
                    return acc
                  }

                  // Default operators:
                  // - arrays -> in
                  // - strings -> contains (insensitive)
                  // - others -> eq
                  if (Array.isArray(v)) {
                    acc[filter.id] = { op: 'in', value: v }
                  } else if (typeof v === 'string') {
                    acc[filter.id] = {
                      op: 'contains',
                      value: v,
                      mode: 'insensitive',
                    }
                  } else {
                    acc[filter.id] = { op: 'eq', value: v }
                  }

                  return acc
                },
                {} as Record<string, unknown>,
              )

              if (Object.keys(filters).length > 0) {
                updates.filters = JSON.stringify(filters)
              } else {
                delete updates.filters
              }
            } else {
              delete updates.filters
            }
          }

          // Update expanded
          if (newState.expanded !== undefined) {
            const expandedIds = Object.entries(newState.expanded)
              .filter(([, isExpanded]) => isExpanded)
              .map(([id]) => id)
            if (expandedIds.length > 0) {
              updates.expanded = JSON.stringify(expandedIds)
            } else {
              delete updates.expanded
            }
          }

          return updates as unknown as TSearch
        },
      })
    },
  }
}

// ============================================================================
// URL State Adapter for React Router (generic)
// ============================================================================

export function createReactRouterAdapter(
  setSearchParams: (
    updater: (prev: URLSearchParams) => URLSearchParams,
  ) => void,
  searchParams: URLSearchParams,
): DataTableStateAdapter {
  return {
    getState: () => {
      const state: Partial<DataTableState> = {};

      // Parse sorting from URL
      const sortBy = searchParams.get("sortBy");
      const sortOrder = searchParams.get("sortOrder");
      if (sortBy) {
        state.sorting = [
          {
            id: sortBy,
            desc: sortOrder === "desc",
          },
        ];
      }

      // Parse pagination from URL
      const page = searchParams.get("page");
      const limit = searchParams.get("limit");
      if (page || limit) {
        state.pagination = {
          pageIndex: (parseInt(page || "1") || 1) - 1,
          pageSize: parseInt(limit || "10") || 10,
        };
      }

      // Parse global filter from URL
      const search = searchParams.get("search");
      if (search) {
        state.globalFilter = search;
      }

      // Parse column filters from URL
      const filters = searchParams.get("filters");
      if (filters) {
        try {
          const parsed = JSON.parse(filters);
          state.columnFilters = Object.entries(parsed).map(([id, value]) => ({
            id,
            value,
          }));
        } catch {
          // Invalid filters format
        }
      }

      // Parse expanded from URL
      const expanded = searchParams.get("expanded");
      if (expanded) {
        try {
          const parsed = JSON.parse(expanded);
          if (Array.isArray(parsed)) {
            state.expanded = parsed.reduce(
              (acc, id) => {
                acc[id] = true;
                return acc;
              },
              {} as Record<string, boolean>,
            );
          }
        } catch {
          // Invalid expanded format
        }
      }

      return state;
    },

    setState: (newState) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);

        // Update sorting
        if (newState.sorting !== undefined) {
          if (newState.sorting.length > 0) {
            params.set("sortBy", newState.sorting[0].id);
            params.set("sortOrder", newState.sorting[0].desc ? "desc" : "asc");
          } else {
            params.delete("sortBy");
            params.delete("sortOrder");
          }
        }

        // Update pagination
        if (newState.pagination !== undefined) {
          params.set("page", String(newState.pagination.pageIndex + 1));
          params.set("limit", String(newState.pagination.pageSize));
        }

        // Update global filter
        if (newState.globalFilter !== undefined) {
          if (newState.globalFilter) {
            params.set("search", newState.globalFilter);
          } else {
            params.delete("search");
          }
        }

        // Update column filters
        if (newState.columnFilters !== undefined) {
          if (newState.columnFilters.length > 0) {
            const filters = newState.columnFilters.reduce(
              (acc, filter) => {
                acc[filter.id] = filter.value;
                return acc;
              },
              {} as Record<string, any>,
            );
            params.set("filters", JSON.stringify(filters));
          } else {
            params.delete("filters");
          }
        }

        // Update expanded
        if (newState.expanded !== undefined) {
          const expandedIds = Object.entries(newState.expanded)
            .filter(([, isExpanded]) => isExpanded)
            .map(([id]) => id);
          if (expandedIds.length > 0) {
            params.set("expanded", JSON.stringify(expandedIds));
          } else {
            params.delete("expanded");
          }
        }

        return params;
      });
    },
  };
}

// ============================================================================
// Hook for using DataTable with URL state
// ============================================================================

export function useDataTableState(
  adapter?: DataTableStateAdapter,
  defaultState?: Partial<DataTableState>,
) {
  const [internalState, setInternalState] = useState<DataTableState>(() => ({
    sorting: defaultState?.sorting || [],
    columnFilters: defaultState?.columnFilters || [],
    globalFilter: defaultState?.globalFilter || "",
    pagination: defaultState?.pagination || { pageIndex: 0, pageSize: 10 },
    rowSelection: defaultState?.rowSelection || {},
    expanded: defaultState?.expanded || {},
    columnVisibility: defaultState?.columnVisibility || {},
  }));

  // Merge adapter state with internal state
  const mergedState = useMemo(() => {
    if (!adapter) return internalState;
    const adapterState = adapter.getState();
    return {
      ...internalState,
      ...adapterState,
    };
  }, [adapter, internalState]);

  // Update state handler
  const updateState = useCallback(
    (updates: Partial<DataTableState>) => {
      setInternalState((prev) => ({ ...prev, ...updates }));
      adapter?.setState(updates);
    },
    [adapter],
  );

  return {
    state: mergedState,
    updateState,
  };
}

// ============================================================================
// Main Component
// ============================================================================

export function DataTable<T extends { id: string }>({
  data,
  columns,
  title,
  description,
  isLoading = false,
  loadingMessage = "Ładowanie danych...",
  searchEnabled = true,
  searchPlaceholder = "Szukaj...",
  searchKeys,
  onSearchChange,
  filters,
  onFilterChange,
  defaultSort,
  onSortChange,
  selectionEnabled = false,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  manualSorting = false,
  manualFiltering = false,
  manualGlobalFilter = false,
  bulkActions,
  rowActions,
  onRowClick,
  globalAction,
  addButton,
  refreshEnabled = true,
  onRefresh,
  isRefreshing = false,
  export: exportConfig,
  pagination,
  emptyState,
  expandable,
  stateAdapter,
  toolbarLeft,
  toolbarRight,
  className,
  tableClassName,
  stickyHeader = false,
  storageKey,
  onStateChange,
}: DataTableProps<T>) {
  const { toast } = useToast()
  const resolvedFilters = filters ?? EMPTY_FILTERS;
  const resolvedBulkActions = (bulkActions ?? EMPTY_BULK_ACTIONS) as BulkAction<T>[];
  const resolvedRowActions = (rowActions ?? EMPTY_ROW_ACTIONS) as RowAction<T>[];

  // ============================================================================
  // State Management
  // ============================================================================

  // Get initial state from adapter or defaults
  const getInitialState = useCallback(() => {
    const adapterState = stateAdapter?.getState() || {};

    // Default sorting
    let initialSorting: SortingState = [];
    if (adapterState.sorting) {
      initialSorting = adapterState.sorting;
    } else if (defaultSort?.id && defaultSort?.direction) {
      initialSorting = [
        { id: defaultSort.id, desc: defaultSort.direction === "desc" },
      ];
    }

    // Default pagination
    let initialPageSize = pagination?.pageSize || 10;
    if (storageKey && typeof window !== "undefined") {
      const stored = localStorage.getItem(`${storageKey}-pageSize`);
      if (stored) {
        const parsed = Number(stored);
        if (!isNaN(parsed) && parsed > 0) initialPageSize = parsed;
      }
    }

    const initialPagination: PaginationState = adapterState.pagination || {
      pageIndex: (pagination?.currentPage || 1) - 1,
      pageSize: initialPageSize,
    };

    // Default expanded
    let initialExpanded: ExpandedState = {};
    if (adapterState.expanded) {
      initialExpanded = adapterState.expanded;
    } else if (expandable?.defaultExpanded) {
      initialExpanded = expandable.defaultExpanded.reduce(
        (acc, id) => {
          acc[id] = true;
          return acc;
        },
        {} as Record<string, boolean>,
      );
    }

    return {
      sorting: initialSorting,
      pagination: initialPagination,
      globalFilter: adapterState.globalFilter || "",
      columnFilters: adapterState.columnFilters || [],
      expanded: initialExpanded,
    };
  }, [stateAdapter, defaultSort, pagination, storageKey, expandable]);

  const initialState = useMemo(() => getInitialState(), [getInitialState]);

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>(initialState.sorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    initialState.columnFilters,
  );
  const [globalFilter, setGlobalFilter] = useState(initialState.globalFilter);
  const [paginationState, setPaginationState] = useState<PaginationState>(
    initialState.pagination,
  );
  const [expanded, setExpanded] = useState<ExpandedState>(
    initialState.expanded,
  );

  // Keep pagination state in sync with externally controlled props (server-side pagination)
  useEffect(() => {
    if (!pagination?.enabled) return;

    const desiredPageIndex = (pagination.currentPage || 1) - 1;
    const desiredPageSize = pagination.pageSize || paginationState.pageSize;

    // Avoid unnecessary updates
    if (
      paginationState.pageIndex !== desiredPageIndex ||
      paginationState.pageSize !== desiredPageSize
    ) {
      setPaginationState((prev) => ({
        ...prev,
        pageIndex: desiredPageIndex,
        pageSize: desiredPageSize,
      }));
    }
  }, [
    pagination?.enabled,
    pagination?.currentPage,
    pagination?.pageSize,
    paginationState.pageIndex,
    paginationState.pageSize,
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => {
      const visibility: VisibilityState = {};
      columns.forEach((col) => {
        if (col.hidden) {
          visibility[col.id] = false;
        }
      });
      return visibility;
    },
  );

  // Row selection (controlled or uncontrolled)
  const [internalRowSelection, setInternalRowSelection] =
    useState<RowSelectionState>({});
  const rowSelection = useMemo(() => {
    if (controlledSelectedIds) {
      const selection: RowSelectionState = {};
      controlledSelectedIds.forEach((id) => {
        selection[id] = true;
      });
      return selection;
    }
    return internalRowSelection;
  }, [controlledSelectedIds, internalRowSelection]);

  const setRowSelection = useCallback(
    (
      updater:
        | RowSelectionState
        | ((old: RowSelectionState) => RowSelectionState),
    ) => {
      const newSelection =
        typeof updater === "function" ? updater(rowSelection) : updater;

      if (onSelectionChange) {
        const selectedIds = new Set(
          Object.entries(newSelection)
            .filter(([, selected]) => selected)
            .map(([id]) => id),
        );
        onSelectionChange(selectedIds);
      } else {
        setInternalRowSelection(newSelection);
      }
    },
    [onSelectionChange, rowSelection],
  );

  // Convert our column definitions to TanStack Table format
  const tanstackColumns = useMemo<TanStackColumnDef<T>[]>(() => {
    const cols: TanStackColumnDef<T>[] = [];

    // Add expand column if expandable
    if (expandable) {
      cols.push({
        id: "_expand",
        header: "",
        size: 40,
        cell: ({ row }) => {
          const canExpand = expandable.canExpand
            ? expandable.canExpand(row.original)
            : true;
          if (!canExpand) return null;
          return (
            <ExpandButton
              isExpanded={row.getIsExpanded()}
              onClick={() => row.toggleExpanded()}
            />
          );
        },
      });
    }

    // Add selection column if enabled
    if (selectionEnabled) {
      cols.push({
        id: "_select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el instanceof HTMLInputElement) {
                el.indeterminate = table.getIsSomePageRowsSelected()
              }
            }}
            onCheckedChange={(checked) =>
              table.toggleAllPageRowsSelected(!!checked)
            }
            aria-label="Zaznacz wszystkie"
          />
        ),
        size: 50,
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(!!checked)}
            aria-label="Zaznacz wiersz"
          />
        ),
      });
    }

    // Convert user columns
    columns.forEach((col) => {
      const tanstackCol: TanStackColumnDef<T> & {
        accessorFn?: (row: T) => unknown
        accessorKey?: string
        filterFn?: (row: Row<T>, columnId: string, filterValue: unknown) => boolean
      } = {
        id: col.id,
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 w-full">
              {/* Header with sorting */}
              <div className="flex items-center">
                {col.sortable ? (
                  <Button
                    variant="ghost"
                    className={cn(
                      " h-8 w-full",
                      col.headerAlign === "center" && "justify-center w-full",
                      col.headerAlign === "right" && "justify-end w-full",
                    )}
                    onClick={() =>
                      column.toggleSorting(column.getIsSorted() === "asc")
                    }
                  >
                    {col.header}
                    <SortIcon
                      direction={
                        column.getIsSorted() === "asc"
                          ? "asc"
                          : column.getIsSorted() === "desc"
                            ? "desc"
                            : null
                      }
                    />
                  </Button>
                ) : (
                  <span>{col.header}</span>
                )}
              </div>

              {/* Column filter input */}
              {col.filterable && (
                <Input
                  placeholder={`Szukaj...`}
                  value={(column.getFilterValue() as string) ?? ""}
                  onChange={(e) => column.setFilterValue(e.target.value)}
                  className="h-8 text-xs mb-2"
                  onClick={(e) => e.stopPropagation()}
                />
              )}

              {/* Column filter dropdown */}
              {col.filterOptions && col.filterOptions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-between text-xs"
                    >
                      <span className="truncate">
                        {col.filterOptions.find(
                          (o) => o.value === column.getFilterValue(),
                        )?.label || "Wszystkie"}
                      </span>
                      <Filter className="h-3 w-3 ml-1 flex-shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => column.setFilterValue(undefined)}
                    >
                      Wszystkie
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {col.filterOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => column.setFilterValue(option.value)}
                      >
                        {column.getFilterValue() === option.value && (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        },
        size: col.width ? parseInt(col.width) : undefined,
        minSize: col.minWidth ? parseInt(col.minWidth) : undefined,
        maxSize: col.maxWidth ? parseInt(col.maxWidth) : undefined,
        enableSorting: col.sortable ?? false,
        enableColumnFilter:
          col.filterable || (col.filterOptions && col.filterOptions.length > 0),
        cell: ({ row, getValue }) => {
          if (col.cell) {
            return col.cell({
              row: row.original,
              value: getValue(),
              isExpanded: row.getIsExpanded(),
              toggleExpand: () => row.toggleExpanded(),
            });
          }
          return getValue();
        },
        meta: {
          headerAlign: col.headerAlign,
          cellAlign: col.cellAlign,
        },
      };

      // Set accessor
      if (col.accessorFn) {
        tanstackCol.accessorFn = col.accessorFn
      } else if (col.accessorKey) {
        tanstackCol.accessorKey = String(col.accessorKey)
      }

      // Set filter function
      if (col.filterFn) {
        tanstackCol.filterFn = (
          row: Row<T>,
          columnId: string,
          filterValue: unknown,
        ) => {
          return col.filterFn!(row.original, filterValue);
        };
      }

      cols.push(tanstackCol);
    });

    // Add actions column if needed
    if (resolvedRowActions.length > 0) {
      cols.push({
        id: "_actions",
        header: "Akcje",
        size: 30,
        meta: {
          headerAlign: "right",
          cellAlign: "right",
        },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {resolvedRowActions.map((action) => {
                if (action.hidden && action.hidden(row.original)) return null;
                return (
                  <DropdownMenuItem
                    key={action.id}
                    onClick={() => action.onClick(row.original)}
                    className={cn(
                      action.variant === "destructive" && "text-destructive",
                    )}
                  >
                    {action.icon && <span className="mr-2">{action.icon}</span>}
                    {action.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      });
    }

    return cols;
  }, [columns, expandable, selectionEnabled, resolvedRowActions]);

  // ============================================================================
  // TanStack Table Instance
  // ============================================================================

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination: paginationState,
      rowSelection,
      expanded,
      columnVisibility,
    },
    enableRowSelection: selectionEnabled,
    enableExpanding: !!expandable,
    getRowCanExpand: expandable?.canExpand
      ? (row) => expandable.canExpand!(row.original)
      : () => true,
    onSortingChange: (updater) => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      stateAdapter?.setState({ sorting: newSorting });

      // Call legacy callback
      if (onSortChange && newSorting.length > 0) {
        onSortChange(newSorting[0].id, newSorting[0].desc ? "desc" : "asc");
      }
    },
    onColumnFiltersChange: (updater) => {
      const newFilters =
        typeof updater === "function" ? updater(columnFilters) : updater;
      setColumnFilters(newFilters);
      stateAdapter?.setState({ columnFilters: newFilters });
    },
    onGlobalFilterChange: (updater) => {
      const newFilter =
        typeof updater === "function" ? updater(globalFilter) : updater;
      setGlobalFilter(newFilter);
      stateAdapter?.setState({ globalFilter: newFilter });
      onSearchChange?.(newFilter);
    },
    onPaginationChange: (updater) => {
      const newPagination =
        typeof updater === "function" ? updater(paginationState) : updater;
      setPaginationState(newPagination);
      stateAdapter?.setState({ pagination: newPagination });

      // Persist page size
      if (storageKey) {
        localStorage.setItem(
          `${storageKey}-pageSize`,
          String(newPagination.pageSize),
        );
      }

      // Call legacy callbacks
      pagination?.onPageChange?.(newPagination.pageIndex + 1);
      pagination?.onPageSizeChange?.(newPagination.pageSize);
    },
    onRowSelectionChange: setRowSelection,
    onExpandedChange: (updater) => {
      const newExpanded =
        typeof updater === "function" ? updater(expanded) : updater;

      // Handle single expansion mode
      if (
        expandable &&
        !expandable.allowMultiple &&
        typeof newExpanded === "object"
      ) {
        const expandedIds = Object.entries(newExpanded).filter(
          ([, isExpanded]) => isExpanded,
        );
        if (expandedIds.length > 1) {
          // Keep only the last expanded row
          const lastExpanded = expandedIds[expandedIds.length - 1];
          setExpanded({ [lastExpanded[0]]: true });
          stateAdapter?.setState({ expanded: { [lastExpanded[0]]: true } });
          return;
        }
      }

      setExpanded(newExpanded);
      stateAdapter?.setState({
        expanded: newExpanded as Record<string, boolean>,
      });
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: manualFiltering ? undefined : getFilteredRowModel(),
    manualSorting: manualSorting,
    manualFiltering: manualFiltering,
    getPaginationRowModel: pagination?.enabled
      ? getPaginationRowModel()
      : undefined,
    getExpandedRowModel: expandable ? getExpandedRowModel() : undefined,
    getRowId: (row) => row.id,
    manualPagination: !!pagination?.totalItems,
    pageCount: pagination?.totalItems
      ? Math.ceil(pagination.totalItems / paginationState.pageSize)
      : undefined,
    // Global filter function (only if not manual)
    globalFilterFn: manualGlobalFilter
      ? undefined
      : (row, columnId, filterValue) => {
          if (!filterValue) return true;
          const query = String(filterValue).toLowerCase();

          if (searchKeys && searchKeys.length > 0) {
            return searchKeys.some((key) => {
              const value = row.original[key];
              return value && String(value).toLowerCase().includes(query);
            });
          }

          // Search all string values
          return Object.values(row.original).some(
            (value) =>
              value &&
              typeof value === "string" &&
              value.toLowerCase().includes(query),
          );
        },
  });

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({
      sorting,
      columnFilters,
      globalFilter,
      pagination: paginationState,
      rowSelection,
      expanded: expanded as Record<string, boolean>,
      columnVisibility,
    });
  }, [
    sorting,
    columnFilters,
    globalFilter,
    paginationState,
    rowSelection,
    expanded,
    columnVisibility,
    onStateChange,
  ]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleSearchChange = useCallback(
    (value: string) => {
      // In manualGlobalFilter mode, TanStack Table won't run client-side filtering,
      // but we still want the input to update URL/globalFilter state (via adapter)
      // and notify the parent (onSearchChange).
      if (manualGlobalFilter) {
        setGlobalFilter(value);
        stateAdapter?.setState({ globalFilter: value });
        onSearchChange?.(value);
        return;
      }

      table.setGlobalFilter(value);
    },
    [manualGlobalFilter, onSearchChange, setGlobalFilter, stateAdapter, table],
  );

  const handleFilterChange = useCallback(
    (filterId: string, value: string) => {
      const column = table.getColumn(filterId);

      if (column) {
        if (value === "all") {
          column.setFilterValue(undefined);
        } else {
          column.setFilterValue(value);
        }
      }

      // Always notify parent (supports virtual/external filters)
      onFilterChange?.(filterId, value);
    },
    [table, onFilterChange],
  );

  // Initialize virtual filters from:
  // - URL adapter state (if present in columnFilters)
  // - filter.value (controlled)
  // - filter.defaultValue
  useEffect(() => {
    if (!resolvedFilters.length || !onFilterChange) return;

    const adapterState = stateAdapter?.getState?.() ?? {};
    const adapterColumnFilters = adapterState.columnFilters ?? [];

    for (const filter of resolvedFilters) {
      const isVirtual = !!filter.virtual || !table.getColumn(filter.id);
      if (!isVirtual) continue;

      const currentExternal = filter.value;
      if (currentExternal !== undefined && currentExternal !== "") continue;

      const fromAdapter = adapterColumnFilters.find(
        (f) => f.id === filter.id,
      )?.value;
      const initial =
        (fromAdapter !== undefined &&
        fromAdapter !== null &&
        String(fromAdapter) !== ""
          ? String(fromAdapter)
          : undefined) ??
        (filter.defaultValue && filter.defaultValue !== "all"
          ? filter.defaultValue
          : undefined);

      if (initial) {
        onFilterChange(filter.id, initial);
      }
    }
    // We intentionally do not depend on `table` state changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedFilters, onFilterChange, stateAdapter])

  // Built-in export hook (always call to satisfy Rules of Hooks)
  const builtInExport = useDataTableExport(
    exportConfig?.resource
      ? {
          resource: exportConfig.resource,
          columns: exportConfig.columns || columns.map((col) => ({
            id: col.id,
            header: typeof col.header === 'string' ? col.header : col.id,
          })),
          getTableState: () => ({
            sorting,
            pagination: paginationState,
            globalFilter,
            columnFilters,
          }),
          currentPage: pagination?.currentPage,
          currentPageSize: pagination?.pageSize,
          searchTerm: typeof globalFilter === 'string' ? globalFilter : undefined,
          toast,
        }
      : undefined
  )

  const isExporting = builtInExport?.isExporting ?? false

  const handleExport = useCallback(
    async (format: string) => {
      // Use built-in export if resource is provided
      if (exportConfig?.resource && builtInExport) {
        await builtInExport.exportData(format as 'CSV' | 'XLSX' | 'PDF')
        return
      }

      // Legacy callback support
      if (exportConfig?.onExport) {
        const selectedRows = table.getSelectedRowModel().rows;
        const dataToExport =
          selectedRows.length > 0
            ? selectedRows.map((row) => row.original)
            : table.getFilteredRowModel().rows.map((row) => row.original);
        exportConfig.onExport(format, dataToExport);
      }
    },
    [exportConfig, table],
  );

  // Get selected rows for bulk actions
  const selectedRows = useMemo(
    () => table.getSelectedRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getSelectedRowModel().rows],
  );

  // Pagination info
  const totalItems =
    pagination?.totalItems ?? table.getFilteredRowModel().rows.length;
  const totalPages = table.getPageCount();
  const currentPage = paginationState.pageIndex + 1;
  const pageSize = paginationState.pageSize;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={cn("rounded-md border bg-card shadow-sm", className)}>
      {/* Header */}
      {(title ||
        description ||
        addButton ||
        refreshEnabled ||
        exportConfig?.enabled) && (
        <div className="p-4 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-muted/5">
          <div>
            {title && (
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {refreshEnabled && onRefresh && (
              <Button
                variant="outline"
                size="icon"
                onClick={onRefresh}
                disabled={isLoading || isRefreshing}
                title="Odśwież dane"
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    (isLoading || isRefreshing) && "animate-spin",
                  )}
                />
              </Button>
            )}

            {exportConfig?.enabled && (
              <ExportMenu
                formats={exportConfig.formats || ['XLSX', 'CSV', 'PDF']}
                onExport={handleExport}
                isExporting={isExporting}
              />
            )}

            {addButton && (
              addButton.permission ? (
                <PermissionGuard permissions={[addButton.permission]}>
                  <Button
                    className="gap-2 flex-1 sm:flex-none"
                    onClick={addButton.onClick}
                    variant={addButton.variant}
                    disabled={addButton.disabled}
                  >
                    {addButton.icon || <Plus className="h-4 w-4" />}
                    {addButton.label}
                  </Button>
                </PermissionGuard>
              ) : (
                <Button
                  className="gap-2 flex-1 sm:flex-none"
                  onClick={addButton.onClick}
                  variant={addButton.variant}
                  disabled={addButton.disabled}
                >
                  {addButton.icon || <Plus className="h-4 w-4" />}
                  {addButton.label}
                </Button>
              )
            )}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {toolbarLeft}

          {searchEnabled && (
            <div className="relative w-full sm:w-[300px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                className="pl-9"
                value={globalFilter}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          {toolbarRight}

          {/* Filters */}
          {resolvedFilters.map((filter) => {
            const isVirtual = !!filter.virtual;

            const column = isVirtual ? undefined : table.getColumn(filter.id);

            // If a filter isn't marked as virtual but has no matching column, treat it as virtual to avoid TanStack warnings.
            const effectiveVirtual = isVirtual || !column;

            const currentValue = effectiveVirtual
              ? (filter.value ??
                (filter.defaultValue && filter.defaultValue !== "all"
                  ? filter.defaultValue
                  : undefined))
              : (((column!.getFilterValue() as string | undefined) ??
                  (filter.defaultValue && filter.defaultValue !== "all"
                    ? filter.defaultValue
                    : undefined)) as string | undefined);

            return (
              <DropdownMenu key={filter.id}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Filter className="h-4 w-4" />
                    {filter.options.find((o) => o.value === currentValue)
                      ?.label || filter.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => handleFilterChange(filter.id, "all")}
                  >
                    {filter.label} (wszystkie)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {filter.options.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() =>
                        handleFilterChange(filter.id, option.value)
                      }
                    >
                      {currentValue === option.value && (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}

          {/* Bulk Actions or Global Action */}
          {selectedRows.length > 0 ? (
            <div className="flex items-center gap-2">
              {resolvedBulkActions.map((action) => (
                <Button
                  key={action.id}
                  variant={action.variant || "default"}
                  onClick={() => action.onClick(selectedRows)}
                  className="gap-2 whitespace-nowrap"
                >
                  {action.icon}
                  {action.label} ({selectedRows.length})
                </Button>
              ))}
            </div>
          ) : (
            globalAction && (
              <Button
                variant="default"
                onClick={globalAction.onClick}
                className="gap-2 whitespace-nowrap"
              >
                {globalAction.icon}
                {globalAction.label}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Table */}
      <div
        className={cn(
          stickyHeader && "max-h-[600px] overflow-auto",
          "relative",
        )}
      >
        {isLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-background/90 shadow-sm border animate-in fade-in zoom-in-95 duration-200">
              <Loader className="h-8 w-8 text-primary" />
              <span className="text-sm text-muted-foreground font-medium">
                {loadingMessage}
              </span>
            </div>
          </div>
        )}
        <Table className={tableClassName}>
          <TableHeader
            className={cn(stickyHeader && "sticky top-0 bg-card z-10")}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | { headerAlign?: string }
                    | undefined;
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className={cn(
                        meta?.headerAlign === "center" && "text-center",
                        meta?.headerAlign === "right" && "text-right",
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      "group",
                      row.getIsExpanded() && "bg-muted/30",
                      onRowClick && "cursor-pointer hover:bg-muted/50"
                    )}
                    onClick={() => onRowClick && onRowClick(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as
                        | { cellAlign?: string }
                        | undefined;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "py-3 text-sm",
                            meta?.cellAlign === "center" && "text-center",
                            meta?.cellAlign === "right" && "text-right",
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>

                  {/* Expanded row content */}
                  {expandable && row.getIsExpanded() && (
                    <TableRow className="bg-muted/20 hover:bg-muted/30">
                      <TableCell
                        colSpan={row.getVisibleCells().length}
                        className="p-0"
                      >
                        <ExpandedRowContent
                          content={expandable.renderExpanded(row.original)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            ) : !isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-full p-0"
                >
                  <EmptyState
                    title={emptyState?.title || "Brak danych"}
                    description={
                      emptyState?.description ||
                      "Nie znaleziono elementów spełniających kryteria."
                    }
                    icon={emptyState?.icon}
                    action={emptyState?.action}
                    className="py-12"
                  />
                </TableCell>
              </TableRow>
            ) : (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell
                    colSpan={table.getAllColumns().length}
                    className="h-12"
                  >
                    <div className="h-4 w-full bg-muted/20 animate-pulse rounded" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer with Pagination */}
      {pagination?.enabled && (
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-t bg-muted/5 gap-4">
          <div className="flex items-center gap-4 order-2 sm:order-1">
            <div className="text-sm text-muted-foreground">
              Strona {currentPage} z {totalPages || 1} ({totalItems} elementów)
            </div>

            {pagination.pageSizeOptions &&
              pagination.pageSizeOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Pokaż:</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-8 w-[70px] justify-between"
                      >
                        {pageSize}
                        <ChevronRight className="h-4 w-4 rotate-90 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      {pagination.pageSizeOptions.map((size) => (
                        <DropdownMenuItem
                          key={size}
                          onClick={() => table.setPageSize(size)}
                          className={cn(
                            "cursor-pointer",
                            pageSize === size && "bg-accent",
                          )}
                        >
                          {pageSize === size && (
                            <Check className="h-4 w-4 mr-2" />
                          )}
                          {size}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1 order-1 sm:order-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (pagination?.totalItems && pagination?.onPageChange) {
                    pagination.onPageChange(1);
                    return;
                  }
                  table.setPageIndex(0);
                }}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (pagination?.totalItems && pagination?.onPageChange) {
                    pagination.onPageChange(currentPage - 1);
                    return;
                  }
                  table.previousPage();
                }}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8 text-xs"
                    onClick={() => {
                      if (pagination?.totalItems && pagination?.onPageChange) {
                        pagination.onPageChange(pageNum);
                        return;
                      }
                      table.setPageIndex(pageNum - 1);
                    }}
                  >
                    {pageNum}
                  </Button>
                );
              })}

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (pagination?.totalItems && pagination?.onPageChange) {
                    pagination.onPageChange(currentPage + 1);
                    return;
                  }
                  table.nextPage();
                }}
                disabled={!table.getCanNextPage()}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (pagination?.totalItems && pagination?.onPageChange) {
                    pagination.onPageChange(totalPages);
                    return;
                  }
                  table.setPageIndex(totalPages - 1);
                }}
                disabled={!table.getCanNextPage()}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { Badge } from "@/components/ui/badge";
export type { Row, TanStackTable as Table };

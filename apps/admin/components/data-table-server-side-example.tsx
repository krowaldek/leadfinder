import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DataTable, type ColumnDef, type DataTableState } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'

// ============================================================================
// Types
// ============================================================================

interface Asset {
  id: string
  name: string
  type: 'REAL_ESTATE' | 'STOCKS' | 'BONDS' | 'CRYPTO'
  status: 'ACTIVE' | 'INACTIVE' | 'SOLD'
  value: number
  description: string
  createdAt: string
}

interface ApiParams {
  // Pagination
  page: number
  limit: number

  // Sorting
  sortBy?: string
  sortOrder?: 'asc' | 'desc'

  // Global search
  search?: string

  // Column filters
  filters?: Record<string, string>
}

interface ApiResponse {
  data: Asset[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 0,
  }).format(value)

const formatDate = (value: string) => new Date(value).toLocaleDateString('pl-PL')

// ============================================================================
// Mock API
// ============================================================================

const mockApi = {
  async getAssets(params: ApiParams): Promise<ApiResponse> {
    // Symulacja opóźnienia sieciowego
    await new Promise((resolve) => setTimeout(resolve, 500))

    console.log('🌐 Server-side request:', params)

    // W prawdziwej aplikacji: return axios.get('/api/assets', { params })
    return {
      data: [
        {
          id: '1',
          name: 'Apartament Warszawa',
          type: 'REAL_ESTATE',
          status: 'ACTIVE',
          value: 500000,
          description: 'Luksusowy apartament w centrum',
          createdAt: '2024-01-15',
        },
        {
          id: '2',
          name: 'Akcje PKO BP',
          type: 'STOCKS',
          status: 'ACTIVE',
          value: 25000,
          description: 'Pakiet akcji bankowych',
          createdAt: '2024-02-20',
        },
        // ... więcej danych
      ],
      meta: {
        total: 125,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(125 / params.limit),
      },
    }
  },
}

// ============================================================================
// Component
// ============================================================================

export function ServerSideDataTableExample() {
  // ============================================================================
  // State - wszystkie parametry server-side
  // ============================================================================

  const [params, setParams] = useState<ApiParams>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    search: '',
    filters: {},
  })

  // ============================================================================
  // Data fetching - React Query
  // ============================================================================

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['assets', params],
    queryFn: () => mockApi.getAssets(params),
    // Opcjonalnie: keepPreviousData dla lepszego UX
    placeholderData: (previousData) => previousData,
  })

  // ============================================================================
  // Column definitions
  // ============================================================================

  const columns: ColumnDef<Asset>[] = [
    {
      id: 'name',
      header: 'Nazwa',
      accessorKey: 'name',
      sortable: true,
      filterable: true, // Pole tekstowe w headerze
      width: '250px',
    },
    {
      id: 'type',
      header: 'Typ',
      accessorKey: 'type',
      sortable: true,
      filterOptions: [
        // Dropdown w headerze
        { label: 'Nieruchomość', value: 'REAL_ESTATE' },
        { label: 'Akcje', value: 'STOCKS' },
        { label: 'Obligacje', value: 'BONDS' },
        { label: 'Krypto', value: 'CRYPTO' },
      ],
      cell: ({ value }) => {
        const variants = {
          REAL_ESTATE: 'default',
          STOCKS: 'secondary',
          BONDS: 'outline',
          CRYPTO: 'destructive',
        } as const

        const type = value as Asset['type']
        return <Badge variant={variants[type]}>{type}</Badge>
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      filterOptions: [
        // Dropdown w headerze
        { label: 'Aktywny', value: 'ACTIVE' },
        { label: 'Nieaktywny', value: 'INACTIVE' },
        { label: 'Sprzedany', value: 'SOLD' },
      ],
      cell: ({ value }) => {
        const variants = {
          ACTIVE: 'default',
          INACTIVE: 'secondary',
          SOLD: 'outline',
        } as const

        const status = value as Asset['status']
        return <Badge variant={variants[status]}>{status}</Badge>
      },
    },
    {
      id: 'value',
      header: 'Wartość',
      accessorFn: (row) => formatCurrency(row.value),
      sortable: true,
      cellAlign: 'right',

      headerAlign: 'right',
      width: '150px',
    },
    {
      id: 'description',
      header: 'Opis',
      accessorKey: 'description',
      filterable: true, // Pole tekstowe w headerze
    },
    {
      id: 'createdAt',
      header: 'Data utworzenia',
      accessorFn: (row) => formatDate(row.createdAt),
      sortable: true,
      width: '150px',
    },
  ]

  // ============================================================================
  // Handlers - update params when table state changes
  // ============================================================================

  const handleStateChange = (state: DataTableState) => {
    setParams((prev) => {
      const updates: Partial<ApiParams> = {}

      // Sortowanie
      if (state.sorting.length > 0) {
        updates.sortBy = state.sorting[0].id
        updates.sortOrder = state.sorting[0].desc ? 'desc' : 'asc'
      } else {
        updates.sortBy = undefined
        updates.sortOrder = undefined
      }

      // Global search
      updates.search = state.globalFilter || ''

      // Column filters
      updates.filters = state.columnFilters.reduce(
        (acc, filter) => {
          acc[filter.id] = filter.value as string
          return acc
        },
        {} as Record<string, string>
      )

      // Reset do strony 1 przy zmianie filtrów/sortowania/search
      const shouldResetPage =
        updates.sortBy !== prev.sortBy ||
        updates.sortOrder !== prev.sortOrder ||
        updates.search !== prev.search ||
        JSON.stringify(updates.filters) !== JSON.stringify(prev.filters)

      return {
        ...prev,
        ...updates,
        page: shouldResetPage ? 1 : prev.page,
      }
    })
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="space-y-4">
      {/* Debug info - pokaż aktualne parametry */}
      <div className="p-4 bg-muted rounded-lg text-xs font-mono">
        <div className="font-semibold mb-2">🔧 Server-side parameters:</div>
        <pre className="whitespace-pre-wrap">{JSON.stringify(params, null, 2)}</pre>
      </div>

      <DataTable
        // Data
        data={data?.data ?? []}
        columns={columns}
        // Loading states
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        // Header
        title="Aktywa"
        description="Wszystkie operacje wykonywane server-side"
        // ============================================================================
        // SERVER-SIDE FLAGS - to jest kluczowe!
        // ============================================================================
        manualSorting={true} // ← Sortowanie na serwerze
        manualFiltering={true} // ← Filtrowanie kolumn na serwerze
        manualGlobalFilter={true} // ← Global search na serwerze
        // ============================================================================
        // Global search
        // ============================================================================
        searchEnabled={true}
        searchPlaceholder="Szukaj we wszystkich kolumnach..."
        // Callbacki nie są potrzebne gdy używamy onStateChange
        // ale można je użyć dla kompatybilności wstecznej
        onSearchChange={(query) => {
          console.log('🔍 Global search:', query)
        }}
        // ============================================================================
        // Sorting
        // ============================================================================
        defaultSort={{ id: 'createdAt', direction: 'desc' }}
        onSortChange={(id, direction) => {
          console.log('🔽 Sort change:', id, direction)
        }}
        // ============================================================================
        // Column filters
        // ============================================================================
        onFilterChange={(filterId, value) => {
          console.log('🎯 Column filter:', filterId, '=', value)
        }}
        // ============================================================================
        // Pagination (automatycznie server-side gdy podasz totalItems)
        // ============================================================================
        pagination={{
          enabled: true,
          pageSize: params.limit,
          currentPage: params.page,
          totalItems: data?.meta.total,
          pageSizeOptions: [5, 10, 20, 50, 100],
          onPageChange: (page) => {
            console.log('📄 Page change:', page)
            setParams((prev) => ({ ...prev, page }))
          },
          onPageSizeChange: (limit) => {
            console.log('📊 Page size change:', limit)
            setParams((prev) => ({ ...prev, limit, page: 1 }))
          },
        }}
        // ============================================================================
        // State synchronization - NAJWAŻNIEJSZY CALLBACK
        // ============================================================================
        onStateChange={handleStateChange}
        // ============================================================================
        // Additional features
        // ============================================================================
        refreshEnabled={true}
        onRefresh={() => {
          console.log('🔄 Refresh')
          refetch()
        }}
        export={{
          enabled: true,
          formats: ['xlsx', 'csv', 'pdf'],
          onExport: (format, data) => {
            console.log(`📥 Export ${format}:`, data.length, 'rows')
            // Implementacja eksportu
          },
        }}
        addButton={{
          label: 'Dodaj aktywo',
          onClick: () => console.log('➕ Add new asset'),
        }}
        // Row actions
        rowActions={[
          {
            id: 'edit',
            label: 'Edytuj',
            onClick: (row) => console.log('✏️ Edit:', row.name),
          },
          {
            id: 'delete',
            label: 'Usuń',
            variant: 'destructive',
            onClick: (row) => console.log('🗑️ Delete:', row.name),
          },
        ]}
        // Selection + bulk actions
        selectionEnabled={true}
        bulkActions={[
          {
            id: 'export',
            label: 'Eksportuj',
            onClick: (rows) => console.log('📤 Export selected:', rows.length),
          },
          {
            id: 'delete',
            label: 'Usuń',
            variant: 'destructive',
            onClick: (rows) => console.log('🗑️ Delete selected:', rows.length),
          },
        ]}
        // Styling
        stickyHeader={true}
        className="shadow-lg"
      />

      {/* Status */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${isFetching ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}
          />
          <span>{isFetching ? 'Ładowanie...' : 'Gotowe'}</span>
        </div>

        {data && (
          <div>
            Pokazano {data.data.length} z {data.meta.total} rekordów
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Przykład użycia z TanStack Router
// ============================================================================

export function ServerSideDataTableWithRouter() {
  // Użyj state adaptera dla synchronizacji z URL
  // const navigate = useNavigate()
  // const { search } = useSearch()
  // const stateAdapter = createTanStackRouterAdapter(navigate, search)

  // Wszystko będzie w URL: ?page=1&sortBy=name&sortOrder=asc&search=test&filters={"type":"STOCKS"}

  return (
    <DataTable
      data={[]}
      columns={[]}
      // ... wszystkie props jak wyżej
      // stateAdapter={stateAdapter}
      manualSorting={true}
      manualFiltering={true}
      manualGlobalFilter={true}
    />
  )
}

// ============================================================================
// Przykład integracji z NestJS backend
// ============================================================================

/*
// Backend (NestJS Controller)

@Get('assets')
@ApiQuery({ name: 'page', required: false })
@ApiQuery({ name: 'limit', required: false })
@ApiQuery({ name: 'sortBy', required: false })
@ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
@ApiQuery({ name: 'search', required: false })
@ApiQuery({ name: 'filters', required: false, type: 'string' })
async findAll(@Query() query: FindAssetsDto) {
  const { page = 1, limit = 10, sortBy, sortOrder, search, filters } = query

  const parsedFilters = filters ? JSON.parse(filters) : {}

  const result = await this.assetsService.findAll({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: sortBy ? { [sortBy]: sortOrder || 'asc' } : undefined,
    where: {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(parsedFilters.type && { type: parsedFilters.type }),
      ...(parsedFilters.status && { status: parsedFilters.status }),
    },
  })

  return {
    data: result.items,
    meta: {
      total: result.total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(result.total / limit),
    },
  }
}
*/

// ============================================================================
// Podsumowanie - Flagi server-side
// ============================================================================

/*
┌─────────────────────────────────────────────────────────────────────┐
│ FLAGA                  │ CO ROBI                                     │
├────────────────────────┼─────────────────────────────────────────────┤
│ manualSorting          │ Wyłącza client-side sortowanie             │
│                        │ Oczekuje posortowanych danych z serwera     │
├────────────────────────┼─────────────────────────────────────────────┤
│ manualFiltering        │ Wyłącza client-side filtrowanie kolumn     │
│                        │ Oczekuje przefiltrowanych danych z serwera  │
├────────────────────────┼─────────────────────────────────────────────┤
│ manualGlobalFilter     │ Wyłącza client-side global search          │
│                        │ Oczekuje wyników wyszukiwania z serwera     │
├────────────────────────┼─────────────────────────────────────────────┤
│ pagination.totalItems  │ Automatycznie włącza manualPagination      │
│                        │ Oczekuje odpowiedniej strony z serwera      │
└─────────────────────────────────────────────────────────────────────┘

NAJWAŻNIEJSZE:
- Użyj onStateChange() aby słuchać wszystkich zmian state
- Zaktualizuj parametry API na podstawie state
- Pobierz nowe dane z serwera
- Przekaż nowe dane do DataTable przez prop `data`
- DataTable wyrenderuje już przetworzone dane bez modyfikacji
*/

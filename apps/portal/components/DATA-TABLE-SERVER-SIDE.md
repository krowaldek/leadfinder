# DataTable - Server-Side Mode (Complete Documentation)

## ✅ Updated conventions (important)

This documentation reflects the **current** DataTable + API listing conventions used in the app:

- **URL is the single source of truth** when you use `stateAdapter` (TanStack Router adapter).
- **Server-side mode** is enabled via:
  - `manualSorting`
  - `manualFiltering`
  - `manualGlobalFilter`
- **Listing query params** follow the convention:
  - `page` (1-based)
  - `limit`
  - `sortBy`
  - `sortOrder`
  - `search` (global search)
  - `filters` (**operator-based JSON**, not `{ id: value }`)
- DataTable URL adapters:
  - read/write the above params
  - encode column filters as **operator-based** rules (see `filters` section below)
- Toolbar filters can be **virtual/external** (not tied to a TanStack column id) and should still write into URL `filters` so the backend can filter.

## 🎯 Overview

The `DataTable` component supports **full server-side mode** for all operations:

- ✅ Pagination
- ✅ Sorting
- ✅ Column filtering (text input + dropdown)
- ✅ Global search (URL-driven)
- ✅ Toolbar filters (including **virtual/external** filters stored in URL `filters`)
- ✅ All of the above simultaneously

---

## 🚀 Quick Start

```typescript
import { DataTable } from '@/components/ui/data-table'
import { useQuery } from '@tanstack/react-query'

/**
 * ✅ Recommended pattern for server-side mode:
 * - URL (stateAdapter) is the single source of truth
 * - your query params come directly from `useSearch()`
 * - filters are operator-based JSON in `filters`
 */
function MyComponent() {
  const navigate = useNavigate()
  const search = useSearch()

  const stateAdapter = createTanStackRouterAdapter(navigate, search)

  // Params derived from URL (single source of truth)
  const params = {
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sortBy: search.sortBy,
    sortOrder: search.sortOrder,
    search: search.search,
    filters: search.filters ? JSON.parse(search.filters) : undefined,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['items', params],
    queryFn: () => api.getItems(params),
  })

  return (
    <DataTable
      data={data?.data ?? []}
      columns={columns}
      isLoading={isLoading}
      stateAdapter={stateAdapter}

      // 🔑 SERVER-SIDE FLAGS - enable all!
      manualSorting={true}
      manualFiltering={true}
      manualGlobalFilter={true}

      // Pagination becomes server-side when `totalItems` is provided
      pagination={{
        enabled: true,
        totalItems: data?.meta.total,
        currentPage: data?.meta.page,
        pageSize: data?.meta.limit,
        onPageChange: (page) => navigate({ search: (prev) => ({ ...prev, page }) }),
        onPageSizeChange: (limit) => navigate({ search: (prev) => ({ ...prev, limit, page: 1 }) }),
      }}
    />
  )
}
```

Notes:

- When `manualGlobalFilter={true}`, global search is **server-side**. DataTable still updates URL (`search`) via adapter.
- When `manualFiltering={true}`, column filters are **server-side**. DataTable writes them to URL as operator-based `filters`.

---

## 📋 Server-Side Flags

### 1. `manualSorting: boolean`

**Disables:** Client-side sorting  
**Requires:** Server-provided sorted data

```typescript
<DataTable
  manualSorting={true}
  defaultSort={{ id: 'name', direction: 'asc' }}
  onSortChange={(id, direction) => {
    // Optional callback (you can use onStateChange instead)
    console.log('Sort:', id, direction)
  }}
/>
```

**Backend (NestJS):**

```typescript
@Get()
async findAll(@Query('sortBy') sortBy?: string, @Query('sortOrder') sortOrder?: string) {
  return this.service.findAll({
    orderBy: sortBy ? { [sortBy]: sortOrder || 'asc' } : undefined
  })
}
```

---

### 2. `manualFiltering: boolean`

**Disables:** Client-side column filtering  
**Requires:** Server-provided filtered data

✅ Current convention: DataTable encodes column filters into URL `filters` as **operator-based JSON**.

Example shape sent to API:

- text input filters become:
  - `{ "<columnId>": { "op": "contains", "value": "<text>", "mode": "insensitive" } }`
- dropdown filters (strings) become:
  - `{ "<columnId>": { "op": "contains", "value": "<text>", "mode": "insensitive" } }` (default)
- arrays become:
  - `{ "<columnId>": { "op": "in", "value": [ ... ] } }`
- non-strings become:
  - `{ "<columnId>": { "op": "eq", "value": <value> } }`

Backend must implement the same operator-based filters (see `ListQueryDto.filters` + `buildPrismaWhere`).

```typescript
<DataTable
  manualFiltering={true}
  columns={[
    {
      id: 'name',
      header: 'Name',
      filterable: true, // Text input in header
    },
    {
      id: 'status',
      header: 'Status',
      filterOptions: [ // Dropdown in header
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' }
      ]
    }
  ]}
  onFilterChange={(filterId, value) => {
    console.log('Filter:', filterId, '=', value)
  }}
/>
```

**Access filters in `onStateChange`:**

```typescript
onStateChange={(state) => {
  // state.columnFilters = [
  //   { id: 'name', value: 'John' },
  //   { id: 'status', value: 'ACTIVE' }
  // ]

  const filters = state.columnFilters.reduce((acc, filter) => {
    acc[filter.id] = filter.value
    return acc
  }, {})

  // { name: 'John', status: 'ACTIVE' }
  fetchDataWithFilters(filters)
}
```

**Backend (NestJS + Prisma):**

```typescript
@Get()
async findAll(@Query('filters') filtersJson?: string) {
  const filters = filtersJson ? JSON.parse(filtersJson) : {}

  return this.prisma.asset.findMany({
    where: {
      ...(filters.name && {
        name: { contains: filters.name, mode: 'insensitive' }
      }),
      ...(filters.status && { status: filters.status }),
      ...(filters.type && { type: filters.type })
    }
  })
}
```

---

### 3. `manualGlobalFilter: boolean`

**Disables:** Client-side global searching  
**Requires:** Server-provided search results

✅ Current behavior (important):

- The global search input always updates DataTable state.
- In `manualGlobalFilter` mode it **must** also:
  - update URL `search` via `stateAdapter`
  - trigger your server query refetch (because URL params change)

So in server-side mode:

- treat `search` query param as the source of truth
- do NOT keep a separate debounced local state unless you intentionally want debounce.

```typescript
<DataTable
  manualGlobalFilter={true}
  searchEnabled={true}
  searchPlaceholder="Search all fields..."
  onSearchChange={(query) => {
    console.log('Search:', query)
  }}
/>
```

**Backend (NestJS + Prisma):**

```typescript
@Get()
async findAll(@Query('search') search?: string) {
  return this.prisma.asset.findMany({
    where: search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ]
    } : undefined
  })
}
```

---

### 4. `pagination.totalItems: number`

**Automatically enables:** `manualPagination`  
**Requires:** Server-provided page of data

```typescript
<DataTable
  pagination={{
    enabled: true,
    totalItems: data?.meta.total, // ← This enables server-side pagination
    currentPage: params.page,
    pageSize: params.limit,
    pageSizeOptions: [10, 20, 50, 100],
    onPageChange: (page) => setParams(p => ({ ...p, page })),
    onPageSizeChange: (size) => setParams(p => ({ ...p, limit: size, page: 1 }))
  }}
/>
```

**Backend (NestJS + Prisma):**

```typescript
@Get()
async findAll(
  @Query('page') page: number = 1,
  @Query('limit') limit: number = 10
) {
  const skip = (page - 1) * limit

  const [items, total] = await Promise.all([
    this.prisma.asset.findMany({ skip, take: limit }),
    this.prisma.asset.count()
  ])

  return {
    data: items,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }
}
```

---

## 🔄 State Synchronization

### Method 1: `onStateChange` (Recommended)

Single callback for all changes:

```typescript
const handleStateChange = (state: DataTableState) => {
  setParams(prev => {
    const updates = {
      // Sorting
      sortBy: state.sorting[0]?.id,
      sortOrder: state.sorting[0]?.desc ? 'desc' : 'asc',

      // Global search
      search: state.globalFilter || '',

      // Column filters
      filters: state.columnFilters.reduce((acc, filter) => {
        acc[filter.id] = filter.value
        return acc
      }, {}),

      // Reset to page 1 on filter changes
      page: 1
    }

    return { ...prev, ...updates }
  })
}

<DataTable onStateChange={handleStateChange} />
```

### Method 2: Individual Callbacks

```typescript
<DataTable
  onSortChange={(id, direction) => {
    setParams(p => ({ ...p, sortBy: id, sortOrder: direction, page: 1 }))
  }}

  onSearchChange={(query) => {
    setParams(p => ({ ...p, search: query, page: 1 }))
  }}

  onFilterChange={(filterId, value) => {
    setParams(p => ({
      ...p,
      filters: { ...p.filters, [filterId]: value },
      page: 1
    }))
  }}

  pagination={{
    onPageChange: (page) => setParams(p => ({ ...p, page })),
    onPageSizeChange: (size) => setParams(p => ({ ...p, limit: size, page: 1 }))
  }}
/>
```

---

## 🌐 URL Integration (TanStack Router)

```typescript
import { useNavigate, useSearch } from '@tanstack/react-router'
import { createTanStackRouterAdapter } from '@/components/ui/data-table'

function MyComponent() {
  const navigate = useNavigate()
  const search = useSearch()

  // Adapter automatically syncs DataTable state with URL
  const stateAdapter = createTanStackRouterAdapter(navigate, search)

  // URL is the source of truth
  const params = {
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sortBy: search.sortBy,
    sortOrder: search.sortOrder,
    search: search.search,
    filters: search.filters ? JSON.parse(search.filters) : undefined,
  }

  const { data } = useQuery({
    queryKey: ['items', params],
    queryFn: () => api.getItems(params),
  })

  return (
    <DataTable
      data={data?.data ?? []}
      stateAdapter={stateAdapter}
      manualSorting={true}
      manualFiltering={true}
      manualGlobalFilter={true}
      pagination={{
        enabled: true,
        totalItems: data?.meta.total,
      }}
    />
  )
}
```

**URL will look like (operator-based filters):**

```
/assets?page=2&limit=20&sortBy=name&sortOrder=asc&search=test&filters={"status":{"op":"eq","value":"ACTIVE"},"name":{"op":"contains","value":"foo","mode":"insensitive"}}
```

Notes:

- `filters` in URL is JSON-encoded and **operator-based**.
- If you're migrating from legacy `?positionId=...` or similar, move those to `filters` to be compatible with `ListQueryDto` validation.

---

## 📊 Complete Example with React Query

Below is a complete example that matches the **current** conventions:

- Query reads from URL
- DataTable writes to URL via adapter
- Filters are operator-based

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DataTable, type ColumnDef, type DataTableState } from '@/components/ui/data-table'

interface Asset {
  id: string
  name: string
  type: 'REAL_ESTATE' | 'STOCKS' | 'BONDS'
  status: 'ACTIVE' | 'INACTIVE'
  value: number
}

interface ApiParams {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
  filters?: Record<string, string>
}

export function AssetsTable() {
  const [params, setParams] = useState<ApiParams>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    search: '',
    filters: {}
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['assets', params],
    queryFn: () => fetch('/api/assets?' + new URLSearchParams({
      page: String(params.page),
      limit: String(params.limit),
      ...(params.sortBy && { sortBy: params.sortBy }),
      ...(params.sortOrder && { sortOrder: params.sortOrder }),
      ...(params.search && { search: params.search }),
      ...(params.filters && Object.keys(params.filters).length > 0 && {
        filters: JSON.stringify(params.filters),
      }),
    })).then(res => res.json())
  })

  const columns: ColumnDef<Asset>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
      filterable: true, // Text search
    },
    {
      id: 'type',
      header: 'Type',
      accessorKey: 'type',
      sortable: true,
      filterOptions: [ // Dropdown filter
        { label: 'Real Estate', value: 'REAL_ESTATE' },
        { label: 'Stocks', value: 'STOCKS' },
        { label: 'Bonds', value: 'BONDS' }
      ]
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      filterOptions: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' }
      ]
    },
    {
      id: 'value',
      header: 'Value',
      accessorKey: 'value',
      sortable: true,
      cellAlign: 'right'
    }
  ]

  const handleStateChange = (state: DataTableState) => {
    setParams(prev => {
      const newParams = {
        ...prev,
        sortBy: state.sorting[0]?.id,
        sortOrder: state.sorting[0]?.desc ? 'desc' as const : 'asc' as const,
        search: state.globalFilter || '',
        filters: state.columnFilters.reduce((acc, f) => {
          acc[f.id] = f.value as string
          return acc
        }, {} as Record<string, string>)
      }

      // Reset page if filters/sort/search changed
      const shouldResetPage = (
        newParams.sortBy !== prev.sortBy ||
        newParams.sortOrder !== prev.sortOrder ||
        newParams.search !== prev.search ||
        JSON.stringify(newParams.filters) !== JSON.stringify(prev.filters)
      )

      return {
        ...newParams,
        page: shouldResetPage ? 1 : prev.page
      }
    })
  }

  return (
    <DataTable
      // Data
      data={data?.data ?? []}
      columns={columns}

      // Loading
      isLoading={isLoading}

      // SERVER-SIDE MODE
      manualSorting={true}
      manualFiltering={true}
      manualGlobalFilter={true}

      // Search
      searchEnabled={true}
      searchPlaceholder="Search assets..."

      // Pagination
      pagination={{
        enabled: true,
        totalItems: data?.meta.total,
        currentPage: params.page,
        pageSize: params.limit,
        pageSizeOptions: [10, 20, 50, 100],
        onPageChange: (page) => setParams(p => ({ ...p, page })),
        onPageSizeChange: (limit) => setParams(p => ({ ...p, limit, page: 1 }))
      }}

      // State sync
      onStateChange={handleStateChange}

      // Additional features
      refreshEnabled={true}
      onRefresh={refetch}

      addButton={{
        label: 'Add Asset',
        onClick: () => console.log('Add')
      }}
    />
  )
}
```

---

## 🏗️ Backend Implementation (NestJS + Prisma)

### DTO:

```typescript
// find-assets.dto.ts
import { IsOptional, IsInt, Min, IsEnum, IsString } from 'class-validator'
import { Type } from 'class-transformer'

export class FindAssetsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10

  @IsOptional()
  @IsString()
  sortBy?: string

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  filters?: string // JSON string
}
```

### Controller:

```typescript
// assets.controller.ts
import { Controller, Get, Query } from '@nestjs/common'
import { AssetsService } from './assets.service'
import { FindAssetsDto } from './dto/find-assets.dto'

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  async findAll(@Query() query: FindAssetsDto) {
    return this.assetsService.findAll(query)
  }
}
```

### Service:

```typescript
// assets.service.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { FindAssetsDto } from './dto/find-assets.dto'

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: FindAssetsDto) {
    const { page = 1, limit = 10, sortBy, sortOrder, search, filters: filtersJson } = query

    // Parse column filters
    const filters = filtersJson ? JSON.parse(filtersJson) : {}

    // Build where clause
    const where = {
      // Global search
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      // Column filters
      ...(filters.name && {
        name: { contains: filters.name, mode: 'insensitive' },
      }),
      ...(filters.type && { type: filters.type }),
      ...(filters.status && { status: filters.status }),
    }

    // Build orderBy
    const orderBy = sortBy ? { [sortBy]: sortOrder || 'asc' } : { createdAt: 'desc' }

    // Execute queries
    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.asset.count({ where }),
    ])

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }
}
```

---

## 🎨 UI Features Working in Server-Side Mode

✅ Works in server-side mode (current implementation):

- global search (`searchEnabled`, `manualGlobalFilter`) → writes URL `search`
- sorting (`manualSorting`) → writes URL `sortBy/sortOrder`
- column filters (`manualFiltering`) → writes URL `filters` (operator-based)
- pagination (`pagination.totalItems`) → writes URL `page/limit`
- toolbar filters (`filters` prop):
  - can be tied to existing columns
  - can be **virtual/external** (`FilterConfig.virtual` + `FilterConfig.value`)
  - **recommended**: write virtual filters into URL `filters` so they affect the server request

Example (virtual filter stored in URL `filters`):

- UI offers `active|empty`
- URL writes:
  - `filters={"status":{"op":"eq","value":"active"}}`
- backend maps it (custom logic) e.g. to relation `users: { some: {} }`

All these features work normally in server-side mode:

✅ **Sorting** - click on column header  
✅ **Per-column filtering** - text input or dropdown in header  
✅ **Global search** - single search field  
✅ **Pagination** - page and page size changes  
✅ **Selection** - row selection (client-side)  
✅ **Bulk actions** - actions on selected rows  
✅ **Row actions** - action menu for each row  
✅ **Export** - export data (all or selected)  
✅ **Refresh** - data refresh  
✅ **Sticky header** - header sticks on scroll  
✅ **Loading states** - spinner during loading

---

## 📖 Summary

| Operation            | Flag                        | Default     | With Flag   |
| -------------------- | --------------------------- | ----------- | ----------- |
| **Pagination**       | `pagination.totalItems`     | Client-side | Server-side |
| **Sorting**          | `manualSorting={true}`      | Client-side | Server-side |
| **Column filtering** | `manualFiltering={true}`    | Client-side | Server-side |
| **Global search**    | `manualGlobalFilter={true}` | Client-side | Server-side |

### When to Use Server-Side?

✅ **Use server-side when:**

- Large datasets (>1000 records)
- Data fetched from API
- Need URL state (deep linking)
- Backend has indexes and optimizations
- Complex queries (JOIN, aggregations)

❌ **Use client-side when:**

- Small datasets (<500 records)
- Data already loaded in memory
- Simplicity is priority
- Offline first application
- No control over backend

---

## 🐛 Debugging

```typescript
<DataTable
  onStateChange={(state) => {
    console.log('📊 Table state changed:', {
      sorting: state.sorting,
      filters: state.columnFilters,
      globalFilter: state.globalFilter,
      pagination: state.pagination
    })
  }}
/>
```

Check the Network tab in DevTools to see API requests.

---

## ✨ Best Practices

1. **Always reset to page 1** when filters/sorting/search changes
2. **Use React Query** for caching and better UX
3. **Debounce search input** (300-500ms) to avoid spamming API
4. **Show loading states** - `isLoading`, `isFetching`
5. **Handle errors** - show error state when API returns error
6. **Validate parameters** in DTO on backend
7. **Use indexes** in database for sortable/filterable columns
8. **Limit max page size** on backend (e.g. 100)
9. **URL sync** for deep linking and bookmarks
10. **Keep Previous Data** in React Query for smooth transitions

---

Done! 🚀 Now you have **full control** over all server-side operations in `DataTable`.

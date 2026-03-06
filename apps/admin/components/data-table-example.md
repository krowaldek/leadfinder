# Data Table - Column Filtering Examples

This file focuses on **UI-level examples**. For **server-side mode** (URL sync + React Query + NestJS listing conventions), see `DATA-TABLE-SERVER-SIDE.md`.

## Important update (operator-based server-side filters)

As of the latest changes, server-side listing uses an **operator-based `filters` object**, not a simple `{ [id]: value }` map.

### URL / Listing API convention

When using the TanStack Router adapter (`createTanStackRouterAdapter`) in server-side mode, the table state is encoded into URL query params:

- `page` (1-based)
- `limit`
- `sortBy`, `sortOrder`
- `search` (global search)
- `filters` (JSON string)

**Important:** `filters` is encoded as:

```ts
{
  [columnId]: { op: 'contains' | 'eq' | 'in' | ..., value: any, mode?: 'default' | 'insensitive' }
}
```

Example:

```ts
filters = {
  name: { op: 'contains', value: 'john', mode: 'insensitive' },
  status: { op: 'in', value: ['ACTIVE', 'INACTIVE'] },
  positionId: { op: 'eq', value: 'pos_123' },
}
```

This aligns with backend listing helpers (`buildPrismaWhere`) and prevents API errors like `Unsupported operator 'undefined'`.

## 1. Basic Text Search in Column

```typescript
const columns: ColumnDef<Asset>[] = [
  {
    id: 'name',
    header: 'Name',
    accessorKey: 'name',
    sortable: true,
    filterable: true, // ← Enables text input in header
  },
  {
    id: 'description',
    header: 'Description',
    accessorKey: 'description',
    filterable: true, // ← Enables text input in header
  },
  {
    id: 'value',
    header: 'Value',
    accessorKey: 'value',
    sortable: true,
    // No filterable - no search
  },
]

<DataTable
  data={assets}
  columns={columns}
  searchEnabled={true} // Global search
/>
```

## 2. Dropdown Filter in Column (enum/select)

```typescript
const columns: ColumnDef<Asset>[] = [
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    sortable: true,
    filterOptions: [ // ← Enables dropdown in header
      { label: 'Active', value: 'ACTIVE' },
      { label: 'Inactive', value: 'INACTIVE' },
      { label: 'Sold', value: 'SOLD' },
    ],
    cell: ({ value }) => (
      <Badge variant={value === 'ACTIVE' ? 'default' : 'secondary'}>
        {value}
      </Badge>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    accessorKey: 'type',
    filterOptions: [
      { label: 'Real Estate', value: 'REAL_ESTATE' },
      { label: 'Stocks', value: 'STOCKS' },
      { label: 'Bonds', value: 'BONDS' },
    ],
  },
]
```

### Server-side note (dropdown column filters)

In server-side mode (`manualFiltering={true}` + URL adapter), changing a dropdown filter results in URL `filters` being updated with an operator rule, e.g.:

```ts
filters = {
  status: { op: 'eq', value: 'ACTIVE' },
}
```

The backend must whitelist the same `status` key in its listing config (`filterable`).

## 3. Custom Filter Function (Advanced)

```typescript
const columns: ColumnDef<Asset>[] = [
  {
    id: 'value',
    header: 'Value',
    accessorKey: 'value',
    filterable: true,
    // Custom filter function (e.g. number range)
    filterFn: (row, filterValue) => {
      const value = row.value
      const query = filterValue.toLowerCase()

      // Handle range: "1000-5000"
      if (query.includes('-')) {
        const [min, max] = query.split('-').map(Number)
        return value >= min && value <= max
      }

      // Handle operators: ">1000", "<5000"
      if (query.startsWith('>')) {
        return value > Number(query.slice(1))
      }
      if (query.startsWith('<')) {
        return value < Number(query.slice(1))
      }

      // Default: contains text
      return String(value).includes(query)
    },
  },
]
```

## 4. Combination of All Features

```typescript
const columns: ColumnDef<User>[] = [
  {
    id: 'name',
    header: 'Full Name',
    accessorKey: 'name',
    sortable: true,
    filterable: true, // Text input
  },
  {
    id: 'email',
    header: 'Email',
    accessorKey: 'email',
    filterable: true, // Text input
  },
  {
    id: 'role',
    header: 'Role',
    accessorKey: 'role',
    sortable: true,
    filterOptions: [ // Dropdown
      { label: 'Admin', value: 'ADMIN' },
      { label: 'User', value: 'USER' },
      { label: 'Guest', value: 'GUEST' },
    ],
  },
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    filterOptions: [ // Dropdown
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive' },
    ],
  },
  {
    id: 'createdAt',
    header: 'Created At',
    accessorFn: (row) => formatDate(row.createdAt),
    sortable: true,
    // No filtering
  },
]

<DataTable
  data={users}
  columns={columns}
  searchEnabled={true} // Global search above everything
  pagination={{ enabled: true, pageSize: 10 }}
/>
```

## 5. Server-Side Filtering Per Column (UPDATED: operator-based filters)

### Option A: URL-driven server-side listing (recommended, like `positions.tsx` / `users.tsx`)

Use `stateAdapter` to sync DataTable state into URL and build your listing params from URL in the page.

Key points:

- `manualSorting`, `manualFiltering`, `manualGlobalFilter` should be `true`
- `pagination.totalItems` should come from API meta
- `filters` is operator-based (see above)

The adapter encodes/decodes:

- `search` → global search
- `filters` → operator-based column filters
- `sortBy/sortOrder`, `page/limit`

### Option B: React Query state in component (not URL-based)

If you do not want URL sync, you can still run server-side filtering; just remember that `filters` must be operator-based.

```typescript
type ApiFilters = Record<string, { op: 'contains' | 'eq' | 'in'; value?: unknown; mode?: 'default' | 'insensitive' }>

const [query, setQuery] = useState({
  page: 1,
  limit: 10,
  sortBy: 'createdAt' as string | undefined,
  sortOrder: 'desc' as 'asc' | 'desc' | undefined,
  search: '',
  filters: {} as ApiFilters,
})

const { data, isLoading } = useQuery({
  queryKey: ['users', query],
  queryFn: () => api.getUsers(query),
})

<DataTable
  data={data?.data ?? []}
  columns={columns}
  isLoading={isLoading}
  manualSorting={true}
  manualFiltering={true}
  manualGlobalFilter={true}
  pagination={{
    enabled: true,
    totalItems: data?.meta.total,
    currentPage: query.page,
    pageSize: query.limit,
    onPageChange: (page) => setQuery((q) => ({ ...q, page })),
    onPageSizeChange: (limit) => setQuery((q) => ({ ...q, limit, page: 1 })),
  }}
  onStateChange={(state) => {
    const sort = state.sorting[0]
    const nextFilters = state.columnFilters.reduce((acc, f) => {
      const v = f.value

      // Keep it simple: strings -> contains, arrays -> in, others -> eq
      if (Array.isArray(v)) acc[f.id] = { op: 'in', value: v }
      else if (typeof v === 'string') acc[f.id] = { op: 'contains', value: v, mode: 'insensitive' }
      else acc[f.id] = { op: 'eq', value: v }

      return acc
    }, {} as ApiFilters)

    setQuery((q) => ({
      ...q,
      page: 1,
      sortBy: sort?.id,
      sortOrder: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
      search: state.globalFilter || '',
      filters: nextFilters,
    }))
  }}
/>
```

> Note: When using the URL adapter approach, you should NOT keep a separate debounced local search state.
> Treat the URL (`search`) as the single source of truth (this is how the latest `users` view was refactored).

## Differences Between Filter Types

### Global Search (searchEnabled)

- **Single field** for the entire table
- Searches all columns simultaneously
- Located in toolbar above table
- Best for: quick general search

### Column Filters - Text Input (filterable: true)

- **Separate field** in each column header
- Filters only that specific column
- Directly in table header
- Best for: precise search in specific fields

### Column Filters - Dropdown (filterOptions)

- **Dropdown menu** in column header
- For enum/category values
- Predefined list of options
- Best for: status, type, category, role, etc.

### Toolbar Filters (filters prop)

- **Dropdown in toolbar** (above table)
- For key filters
- More visible
- Best for: main application filters

#### Virtual / external toolbar filters (server-side)

Toolbar filters can be used even when there is **no matching Table column**.

Use this for “business filters” that are not a direct column filter (or you simply don’t want a column for them).

Latest behavior:

- `FilterConfig` supports:
  - `virtual?: boolean` (marks filter as external/virtual)
  - `value?: string` + `defaultValue?: string` (controls displayed selection)
- When `virtual: true`, DataTable will **not** attempt to access `table.getColumn(filter.id)`.

Server-side usage pattern:

- Store the selected value in URL listing `filters` (operator-based), e.g.:
  - `filters.positionId = { op: 'eq', value: 'pos_123' }`
- Update URL in `onFilterChange` (or a dedicated handler in the page).
- Your data hook reads URL search + URL filters and performs the request.

This keeps behavior consistent across pages and ensures requests are triggered correctly.

## Complete Example - Assets

```typescript
const columns: ColumnDef<Asset>[] = [
  {
    id: 'name',
    header: 'Name',
    accessorKey: 'name',
    sortable: true,
    filterable: true, // Text search in header
  },
  {
    id: 'type',
    header: 'Type',
    accessorKey: 'type',
    filterOptions: [ // Dropdown in header
      { label: 'All', value: '' },
      { label: 'Real Estate', value: 'REAL_ESTATE' },
      { label: 'Stocks', value: 'STOCKS' },
      { label: 'Crypto', value: 'CRYPTO' },
    ],
    cell: ({ value }) => <Badge>{value}</Badge>,
  },
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    filterOptions: [ // Dropdown in header
      { label: 'Active', value: 'ACTIVE' },
      { label: 'Sold', value: 'SOLD' },
    ],
  },
  {
    id: 'value',
    header: 'Value',
    accessorFn: (row) => formatCurrency(row.value),
    sortable: true,
    cellAlign: 'right',
  },
]

<DataTable
  title="Assets"
  data={assets}
  columns={columns}
  searchEnabled={true} // Global search

  // Additionally: main filters in toolbar
  filters={[
    {
      id: 'status',
      label: 'Status',
      options: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'All', value: 'all' },
      ],
    },
  ]}

  pagination={{ enabled: true, pageSize: 20 }}
/>
```

## Styling Columns with Filters

Columns with `filterable: true` or `filterOptions` automatically render:

1. **Header with text filter** - small input field below column name
2. **Header with dropdown** - button with currently selected value

You can control column width with `width`:

```typescript
{
  id: 'status',
  header: 'Status',
  width: '200px', // More space for dropdown
  filterOptions: [...],
}
```

## 6. Built-in Export Feature

DataTable supports built-in asynchronous export functionality that automatically:
- Collects current table state (sorting, filters, search)
- Creates an export job via backend API
- Polls for completion
- Downloads the file automatically
- Shows toast notifications for progress/errors

### Basic Export Configuration

```typescript
<DataTable
  title="Users"
  data={users}
  columns={columns}
  export={{
    enabled: true,
    resource: 'users', // Backend resource name (required)
  }}
  manualFiltering={true}
  manualSorting={true}
  stateAdapter={stateAdapter}
  // ... other props
/>
```

### Export with Custom Formats

By default, all formats are available (`XLSX`, `CSV`, `PDF`). You can customize:

```typescript
<DataTable
  export={{
    enabled: true,
    resource: 'positions',
    formats: ['XLSX', 'CSV'], // Only Excel and CSV
  }}
  // ... other props
/>
```

**Important:** Format values must be **uppercase** (`'CSV' | 'XLSX' | 'PDF'`) to match the backend Prisma enum.

### Export with Custom Columns

By default, **all table columns** are exported. You can specify which columns to export and in what order:

```typescript
const columns: ColumnDef<User>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  { id: 'email', header: 'Email', accessorKey: 'email' },
  { id: 'phone', header: 'Phone', accessorKey: 'phone' },
  { id: 'status', header: 'Status', accessorKey: 'status' },
  { id: 'createdAt', header: 'Created', accessorKey: 'createdAt' },
  { id: 'actions', header: 'Actions', cell: ({ row }) => <Actions /> },
]

<DataTable
  columns={columns}
  export={{
    enabled: true,
    resource: 'users',
    // Export only these specific columns (in this order)
    columns: [
      { id: 'name', header: 'Full Name' },
      { id: 'email', header: 'Email Address' },
      { id: 'status', header: 'Account Status' },
      { id: 'createdAt', header: 'Registration Date' },
    ]
    // 'phone' and 'actions' columns will NOT be in export
  }}
/>
```

**Use cases:**
- Exclude non-exportable columns (like actions, checkboxes, internal IDs)
- Reorder columns differently than table display
- Use different headers in export than in table
- Export nested/computed fields with custom accessors

**If `export.columns` is not provided:** All table columns are automatically included in export.

#### Nested/Relational Fields (Dot-notation Support)

Backend automatically maps dot-notation field names to their flattened equivalents:

```typescript
// Frontend table definition
const columns: ColumnDef<User>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  { id: 'position.name', header: 'Position', accessorFn: (row) => row.position?.name },
  { id: 'status', header: 'Status', accessorKey: 'status' },
]

<DataTable
  columns={columns}
  export={{
    enabled: true,
    resource: 'users',
    columns: [
      { id: 'name', header: 'Full Name' },
      { id: 'position.name', header: 'Job Position' }, // ✅ Works!
      { id: 'status', header: 'Status' },
    ]
  }}
/>
```

**How it works:**
- Frontend sends: `position.name`
- Backend maps to: `positionName` (flattened key in rows)
- Export includes the correct data with your custom header

**Supported patterns:**
- `position.name` → `positionName`
- `role.code` → `roleCode`
- `department.name` → `departmentName`

**Note:** Backend must flatten the data in its export provider (e.g., `positionName: user.position?.name ?? ''`). The mapping is automatic for standard patterns.

### How It Works

1. **User clicks "Eksportuj"** button in toolbar and selects format
2. **Frontend collects state:**
   - Current sorting (`sortBy`, `sortOrder`)
   - Current filters (operator-based from URL)
   - Global search term
   - Column configuration (order, headers)
3. **POST /exports** creates async job:
   ```typescript
   {
     resource: 'users',
     format: 'XLSX',
     query: {
       page: 1,
       limit: 10,
       sortBy: 'name',
       sortOrder: 'asc',
       search: 'john',
       filters: { status: { op: 'eq', value: 'ACTIVE' } }
     },
     columns: [
       { id: 'name', header: 'Name' },
       { id: 'email', header: 'Email' },
       // ... from table columns
     ],
     maxRows: 100000 // Optional safety guard
   }
   ```
4. **Polling:** Frontend polls `GET /exports/:id` every 2s
5. **Download:** When status is `COMPLETED`, auto-downloads via `GET /exports/:id/download`
6. **Notifications:** Toast messages show progress and errors

### Backend Requirements

For export to work, the backend must have:

1. **Export module** at `apps/api/src/modules/exports`
2. **Export provider** for the resource (e.g., `UsersExportProvider`)
3. **Resource registered** in `ExportsService`

Example provider:

```typescript
@Injectable()
export class UsersExportProvider implements ExportProvider {
  constructor(private prisma: PrismaService) {}

  async export(params: ExportParams): Promise<ExportData> {
    const { query, columns, maxRows } = params
    
    // Use same listing logic as GET /users
    const where = buildPrismaWhere(query?.filters || {}, query?.search)
    const orderBy = buildPrismaOrderBy(query?.sortBy, query?.sortOrder)
    
    const users = await this.prisma.user.findMany({
      where,
      orderBy,
      take: maxRows || 100000,
      include: { position: true, role: true }
    })
    
    return {
      data: users,
      columns: columns || this.getDefaultColumns(),
    }
  }
}
```

### Server-Side Export (URL-based state)

When using server-side mode with URL adapter:

```typescript
const stateAdapter = createTanStackRouterAdapter({
  router,
  navigate,
  route,
  columns,
})

<DataTable
  data={users?.data ?? []}
  columns={columns}
  manualSorting={true}
  manualFiltering={true}
  manualGlobalFilter={true}
  stateAdapter={stateAdapter}
  export={{
    enabled: true,
    resource: 'users',
    // Optional: customize exported columns
    columns: [
      { id: 'name', header: 'User Name' },
      { id: 'email', header: 'Email' },
      { id: 'position.name', header: 'Position', accessor: 'position.name' },
      { id: 'status', header: 'Status' },
    ]
  }}
  pagination={{
    enabled: true,
    totalItems: users?.meta.total,
    // ... pagination config
  }}
/>
```

The export automatically reads state from the URL adapter, ensuring exported data matches what's visible in the table.

### Export vs Legacy onExport Callback

**New way (recommended):**
```typescript
export={{ 
  enabled: true, 
  resource: 'users',
  columns: [ // Optional
    { id: 'name', header: 'Name' },
    { id: 'email', header: 'Email' },
  ]
}}
```

**Old way (deprecated):**
```typescript
export={{
  enabled: true,
  onExport: (format, data) => {
    // Manual export logic
  }
}}
```

The `onExport` callback is legacy and should only be used for special cases where backend export is not available. Always prefer the `resource`-based approach.

### Format Compatibility

The component accepts both uppercase and lowercase format values for backward compatibility:
- Component prop: `formats?: Array<'XLSX' | 'CSV' | 'PDF' | 'xlsx' | 'csv' | 'pdf'>`
- Internally normalized to uppercase before sending to backend
- Backend expects: Prisma enum `ExportFormat { CSV, XLSX, PDF }`

### Complete Example with Custom Export

```typescript
const columns: ColumnDef<User>[] = [
  { id: 'select', header: '', cell: ({ row }) => <Checkbox /> },
  { id: 'avatar', header: '', cell: ({ row }) => <Avatar /> },
  { id: 'name', header: 'Name', accessorKey: 'name' },
  { id: 'email', header: 'Email', accessorKey: 'email' },
  { id: 'position.name', header: 'Position', accessorFn: (row) => row.position?.name },
  { id: 'status', header: 'Status', accessorKey: 'status' },
  { id: 'createdAt', header: 'Created', accessorKey: 'createdAt' },
  { id: 'actions', header: '', cell: ({ row }) => <RowActions /> },
]

<DataTable
  title="Users"
  data={users}
  columns={columns}
  searchEnabled={true}
  export={{
    enabled: true,
    resource: 'users',
    formats: ['XLSX', 'CSV'], // Only Excel and CSV
    // Exclude UI-only columns, customize order and headers
    columns: [
      { id: 'name', header: 'Full Name' },
      { id: 'email', header: 'Email Address' },
      { id: 'position.name', header: 'Job Position' }, // ✅ Dot-notation auto-mapped
      { id: 'status', header: 'Account Status' },
      { id: 'createdAt', header: 'Registration Date' },
    ]
    // Note: select, avatar, actions columns are excluded
    // Note: position.name is automatically mapped to positionName in backend
  }}
  pagination={{ enabled: true, pageSize: 10 }}
/>
```

**What happens in this example:**
1. Table displays all 8 columns including UI-only ones (select, avatar, actions)
2. Export only includes 5 data columns
3. `position.name` (dot-notation) is automatically mapped to `positionName` in backend
4. Custom headers are used in the export file
5. When user clicks "Eksportuj" → chooses format → file downloads with only the 5 specified columns

**Backend requirement:**
```typescript
// In users export provider, ensure data is flattened:
const rows = users.map((u) => ({
  id: u.id,
  name: u.name ?? '',
  email: u.email ?? '',
  positionName: u.position?.name ?? '', // ← Flattened field
  status: u.status,
  createdAt: u.createdAt,
}))
```

The `position.name` from frontend is automatically mapped to `positionName` backend key.

### Troubleshooting

**Export button not showing:**
- Ensure `export.enabled = true`
- Ensure `export.resource` is set
- Check user has `reports.export` permission

**Export fails with 400:**
- Verify format is uppercase in API call
- Check backend has export provider for the resource
- Verify `filters` are operator-based format
- Check `export.columns` IDs match backend field mapping

**Export job stuck in PENDING:**
- Check Redis is running
- Verify BullMQ worker is processing export queue
- Check backend logs for errors

**Downloaded file is empty:**
- Verify export provider returns data
- Check `maxRows` isn't too restrictive
- Verify query/filters are valid
- Check column IDs in `export.columns` are valid

**Wrong columns in export:**
- If `export.columns` is provided, only those columns are exported
- If `export.columns` is NOT provided, all table columns are exported
- Verify column IDs match between table and export configuration
- For nested fields, use dot-notation (e.g., `position.name`) - backend handles mapping

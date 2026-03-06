# React Query + Axios - Przewodnik użycia

Frontend został zaktualizowany do używania **React Query** (TanStack Query) wraz z **Axios** dla wszystkich wywołań API.

## 📦 Zainstalowane pakiety

- `axios` - klient HTTP
- `@tanstack/react-query` - zarządzanie stanem serwera i cache
- `@tanstack/react-query-devtools` - narzędzia developerskie

## 🏗️ Struktura

### 1. API Client (`src/lib/api-client.ts`)

Axios instance z automatycznym:

- Dodawaniem tokena autoryzacji
- Odświeżaniem tokenu przy 401
- Obsługą błędów
- Przekierowaniem do logowania gdy sesja wygasła

```typescript
import { api } from '@/lib/api-client'

// Używaj bezpośrednio jako axios instance
const response = await api.get('/users')
const data = response.data
```

### 2. React Query Hooks

Utworzone hooki dla wszystkich zasobów API w `src/hooks/`:

- **`use-users.ts`** - Użytkownicy (CRUD + bulk delete + avatar)
- **`use-positions.ts`** - Stanowiska (CRUD)
- **`use-activities.ts`** - Aktywności (CRUD)
- **`use-permissions.ts`** - Uprawnienia (CRUD)
- **`use-auth.ts`** - Autentykacja (login, logout, current user)
- **`use-ai.ts`** - AI features (config, chat, suggestions)

## 📖 Jak używać

### Query (GET) - pobieranie danych

```typescript
import { useUsers } from '@/hooks/use-users';

function MyComponent() {
  const { data: users, isLoading, error } = useUsers();

  if (isLoading) return <Loader />;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {users.map(user => <div key={user.id}>{user.email}</div>)}
    </div>
  );
}
```

### Mutation (POST/PATCH/DELETE) - modyfikacja danych

```typescript
import { useCreateUser, useUpdateUser, useDeleteUser } from '@/hooks/use-users';

function MyComponent() {
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const handleCreate = async () => {
    try {
      await createUser.mutateAsync({
        email: 'user@example.com',
        password: 'password123',
        firstName: 'Jan',
        lastName: 'Kowalski',
      });
      toast({ title: 'Sukces!' });
    } catch (error) {
      toast({ title: 'Błąd', variant: 'destructive' });
    }
  };

  const handleUpdate = async (userId: string) => {
    await updateUser.mutateAsync({
      id: userId,
      data: { firstName: 'Nowe imię' }
    });
  };

  const handleDelete = async (userId: string) => {
    await deleteUser.mutateAsync(userId);
  };

  return (
    <Button
      onClick={handleCreate}
      disabled={createUser.isPending}
    >
      {createUser.isPending ? 'Tworzenie...' : 'Utwórz'}
    </Button>
  );
}
```

## ✨ Główne zalety

### 1. Automatyczne cache'owanie

```typescript
// Pierwsze wywołanie - request do API
const { data } = useUsers()

// Drugie wywołanie w innym komponencie - dane z cache
const { data } = useUsers()
```

### 2. Automatyczne odświeżanie po mutacji

```typescript
const createUser = useCreateUser()

// Po sukcesie automatycznie odświeża listę użytkowników
await createUser.mutateAsync(newUser)
```

### 3. Loading i error states

```typescript
const { data, isLoading, error, isFetching } = useUsers()

// isLoading - pierwszy load
// isFetching - refetch w tle
// error - obiekt błędu jeśli wystąpił
```

### 4. Optimistic updates

```typescript
const updateUser = useUpdateUser()

// UI aktualizuje się natychmiast, przed response z serwera
await updateUser.mutateAsync({ id, data })
```

## 🔑 Query Keys

Każdy hook używa dedykowanych query keys dla prawidłowego cache:

```typescript
// use-users.ts
export const userKeys = {
  all: ['users'],
  lists: () => [...userKeys.all, 'list'],
  detail: (id: string) => [...userKeys.all, 'detail', id],
}
```

## 🎯 Przykład refaktoryzacji

### ❌ Stary sposób (fetch + useState)

```typescript
const [users, setUsers] = useState([])
const [isLoading, setIsLoading] = useState(true)

useEffect(() => {
  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const data = await api.get('/users')
      setUsers(data)
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }
  fetchUsers()
}, [])

const handleCreate = async (userData) => {
  await api.post('/users', userData)
  fetchUsers() // Manual refresh
}
```

### ✅ Nowy sposób (React Query)

```typescript
const { data: users, isLoading } = useUsers()
const createUser = useCreateUser()

const handleCreate = async (userData) => {
  await createUser.mutateAsync(userData)
  // Auto-refresh! Nie trzeba ręcznie odświeżać
}
```

## 🔧 Konfiguracja (providers.tsx)

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minuta
      refetchOnWindowFocus: false,
    },
  },
})
```

## 🐛 DevTools

React Query DevTools są włączone w development:

- Pokazują wszystkie queries i mutations
- Stan cache
- Timeline requestów
- Możliwość ręcznego invalidowania cache

## 📚 Dostępne hooki

### Users

- `useUsers()` - lista użytkowników
- `useUser(id)` - pojedynczy użytkownik
- `useCreateUser()` - tworzenie
- `useUpdateUser()` - aktualizacja
- `useDeleteUser()` - usuwanie
- `useBulkDeleteUsers()` - bulk delete
- `useUploadUserAvatar()` - upload avatara

### Positions

- `usePositions()` - lista stanowisk
- `usePosition(id)` - pojedyncze stanowisko
- `useCreatePosition()` - tworzenie
- `useUpdatePosition()` - aktualizacja
- `useDeletePosition()` - usuwanie

### Activities

- `useActivities()` - lista aktywności
- `useActivity(id)` - pojedyncza aktywność
- `useCreateActivity()` - tworzenie
- `useUpdateActivity()` - aktualizacja
- `useDeleteActivity()` - usuwanie

### Permissions

- `usePermissions()` - wszystkie uprawnienia
- `usePermissionsByPosition(positionId)` - uprawnienia dla stanowiska
- `usePermission(id)` - pojedyncze uprawnienie
- `useCreatePermission()` - tworzenie
- `useUpdatePermission()` - aktualizacja
- `useDeletePermission()` - usuwanie

### Auth

- `useCurrentUser()` - aktualnie zalogowany użytkownik
- `useLogin()` - logowanie
- `useLogout()` - wylogowanie
- `useChangePassword()` - zmiana hasła
- `useRefreshToken()` - odświeżanie tokenu

### AI

- `useAIConfig()` - konfiguracja AI
- `useUpdateAIConfig()` - aktualizacja konfiguracji
- `useAIChat()` - chat z AI
- `useAISuggestion()` - sugestie AI

## 📝 Przykład pełnego komponentu

Zobacz: `src/routes/dashboard/users-with-react-query.example.tsx`

## 🚀 Następne kroki

1. Refaktoryzacja istniejących komponentów do używania hooków
2. Dodanie optimistic updates gdzie potrzebne
3. Implementacja infinity scroll dla długich list
4. Dodanie retry logic dla failed mutations

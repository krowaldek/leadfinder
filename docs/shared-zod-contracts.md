# Shared Zod Contracts (API ↔ Web) — Fractify Core

Ten dokument opisuje docelowy standard współdzielenia **kontraktów API** (runtime validation + typy) pomiędzy `apps/api` (NestJS) i `apps/web` (React) z wykorzystaniem **Zod** jako jednego źródła prawdy (SSOT).

## Zasada nadrzędna (SSOT)

- **Jedyne źródło prawdy dla kontraktów** (request/params/query/response) to `packages/types` (schemy Zod + typy inferowane).
- Backend waliduje runtime na podstawie tych schem.
- Frontend:
  - waliduje payload przed wysłaniem requestu,
  - runtime-parsuje odpowiedzi JSON (żeby wykrywać regresje kontraktu wcześniej niż na produkcji).

## Struktura repo i lokalizacja kontraktów

### Gdzie trzymamy schemy

- `packages/types/src/schemas/*` — schemy per moduł/funkcja (np. `users.ts`, `todos.ts`, `scheduler.ts`, `exports.ts`, `notifications.ts`).
- `packages/types/src/contracts/*` — kontrakty wspólne (np. listing `{ data, meta }`).

### Eksporty publiczne

- `packages/types/src/index.ts` re-eksportuje:
  - **value exports** (schemy, funkcje),
  - oraz **type exports** (`export type ...`) dla typów inferowanych.

#### Ważne: value vs type
W `index.ts` pilnuj rozdzielenia:
- `export { someSchema } from ...` dla schem,
- `export type { SomeType } from ...` dla typów.

Unikaj konfliktów nazw (np. istniejące legacy interfejsy w `index.ts` vs nowe typy inferowane z Zoda).

## Konwencje kontraktów

### 1) `params` w API (route params)
Dla endpointów typu `GET /resource/:id` używamy param schem jako **obiekt**:

- `resourceIdParamSchema = z.object({ id: z.string().min(1) })`

Backend (dekorator param) otrzymuje `{ id }`, a nie goły string.

### 2) Daty i datetimes
W JSON:
- używamy ISO stringów,
- walidacja: `z.string().datetime({ offset: true })`

Jeśli backend potrafi zwracać `Date` (np. przez błędną serializację), to należy to ujednolicić po stronie API — w kontrakcie trzymamy string.

### 3) Listing (kolekcje)
Kontrakt listingu:
- query: `page, limit, sortBy, sortOrder, search, filters`
- response: `{ data: T[], meta: { total, page, limit, totalPages } }`

`filters` zawsze operator-based (JSON string w URL), np.:
- `{ "status": { "op": "in", "value": ["ACTIVE"] } }`

### 4) Response shape: wrapped vs top-level
Docelowo:
- endpointy listingu zwracają `{ data, meta }`
- endpointy pojedynczego zasobu: top-level `T`

Jeżeli istnieją endpointy zwracające czasem `{ data: T }`, a czasem `T`, frontend powinien mieć normalizator (tymczasowo) i zawsze parsować finalny `T` przez schema.

### 5) Binary / stream
Nie parsujemy Zodem danych nie-JSON:
- download plików (np. `ArrayBuffer`, `Blob`)
- strumienie SSE/websocket

Tam walidujemy:
- nagłówki,
- shape eventów (jeśli JSON w chunkach / SSE data) — tylko jeśli to ma sens i jest stabilne.

## Backend (NestJS): jak używać shared Zod contracts

### Zasada
W kontrolerach:
- zamiast `@Body()` + DTO + `class-validator` używamy:
  - `@ZodBody(schema)`
  - `@ZodParam(schema)`
  - `@ZodQuery(schema)`

W serwisach:
- typy bazują na `z.infer<typeof schema>` eksportowanych z `@fractify/types`.

### Przykładowy pattern (kontroler)
- importujesz schema/value + typy z `@fractify/types`,
- dekorator waliduje runtime,
- param/body/query są już typowane i “pewne”.

Checklist backend:
- [ ] brak `class-validator` dla endpointów objętych migracją,
- [ ] brak starych DTO importowanych do kontrolerów,
- [ ] param schemas to obiekty (`{ id: ... }`),
- [ ] listing używa wspólnego `listQuerySchema` i zwraca `{ data, meta }`.

## Frontend (apps/web): jak używać shared Zod contracts

### Zasada
W hookach (React Query):
- request body walidujemy: `requestSchema.parse(payload)`
- response JSON parsujemy: `responseSchema.parse(response.data)`

To dotyczy:
- `api.get/post/patch/put/delete` dla JSON
- szczególnie list/detail/create/update

Wyjątki:
- endpointy `204` lub “fire-and-forget” bez body mogą nie parsować response.

### Minimalny wzorzec (hook)
- `api.get<unknown>(...)`
- `schema.parse(response.data)`

Uwaga: typowanie axios `<T>` bez `schema.parse` nie daje runtime gwarancji.

Checklist frontend:
- [ ] hooki importują schemy z `@fractify/types` i parsują JSON response,
- [ ] przed requestem payload przechodzi przez `schema.parse`,
- [ ] parametry (np. `id`) są walidowane przez param schema (np. `todoIdParamSchema.parse({ id })`),
- [ ] listing response parsowany jako `{ data, meta }` lub item-per-item jeśli trzeba.

## Usuwanie legacy DTO / class-validator (cleanup)

Kiedy moduł jest domknięty:
- usuń `apps/api/src/modules/<module>/dto/**` jeśli:
  - nie ma już importów do kontrolerów/serwisów,
  - API weryfikuje Zodem,
  - frontend parsuje odpowiedzi.

Przed usunięciem:
- przeszukaj repo po importach DTO (żeby nie zostawić “martwych importów”),
- zostaw stub (`export {}`) tylko jeśli jest uzasadniona kompatybilność podczas refaktoru.

## Definition of Done dla modułu (E2E)

Moduł uznajemy za “zmigrowany” gdy:

### `packages/types`
- [ ] schemy request/params/query/response istnieją i są eksportowane z `index.ts`
- [ ] brak konfliktów nazw (value vs type)
- [ ] build types przechodzi

### `apps/api`
- [ ] kontrolery używają `@ZodBody/@ZodParam/@ZodQuery`
- [ ] brak `class-validator` DTO dla zmigrowanych endpointów
- [ ] typecheck API przechodzi

### `apps/web`
- [ ] hooki walidują payloady i parsują odpowiedzi JSON
- [ ] UI nie opiera się na “luźnych” `any/unknown` dla danych z API (poza wyjątkami jak binary)
- [ ] w idealnym świecie `tsc --noEmit` przechodzi (status projektu może mieć niezależne warningi/błędy)

## Dokumentacja: gdzie trzymamy pliki `.md`

**Zasada repo:** wszystkie pliki Markdown z dokumentacją projektu trzymamy w katalogu:

- `fractify/docs/`

Wyjątki:
- `README.md` w root (jeśli potrzebny jako landing),
- pliki w `.github/` (np. CONTRIBUTING, templates).

Jeżeli tworzysz nową dokumentację (guides, ADR, how-to), umieszczaj ją w `fractify/docs/` i linkuj z `README.md` lub z innych plików w `docs/`.

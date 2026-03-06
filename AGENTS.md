# Leadfinder - Agent Guidelines

> Wytyczne dla agentów AI pracujacych z projektem Leadfinder.

## Cel projektu

Leadfinder to platforma SaaS do agregowania i prezentowania zapytan ofertowych z zewnetrznych portali, takich jak:

- `ezamowienia`
- `bazakonkurencyjnosci`
- `platformazakupowa`

Docelowo system ma miec 3 glowne obszary:

- `api` - backend, auth, user management, scraping, normalizacja danych, joby
- `admin` - panel wewnetrzny do zarzadzania platforma, userami i scraperami
- `portal` - aplikacja SaaS dla klientow koncowych

## Aktualny priorytet

W obecnej fazie budujemy tylko:

- fundament monorepo na `turborepo`
- backend `apps/api`
- panel administracyjny `apps/admin`
- autoryzacje i zarzadzanie uzytkownikami

Na ten moment `apps/portal` pozostaje poza zakresem implementacji i nie musi byc bootstrapowany w fazie 0 i 1.

## Docelowa struktura repo

Zakladana struktura monorepo:

```text
leadfinder/
├── apps/
│   ├── api/
│   ├── admin/
│   └── portal/         # dopiero w kolejnej fazie
├── packages/
│   ├── contracts/      # wspoldzielone kontrakty Zod i typy
│   ├── ui/             # wspoldzielone komponenty UI, jesli beda potrzebne
│   ├── config/         # shared tsconfig/eslint/env helpers
│   └── api-client/     # opcjonalny wspoldzielony klient API
├── docs/
└── turbo.json
```

Jesli realna struktura sie zmieni, nalezy zaktualizowac ten plik zamiast utrzymywac stare zalozenia.

## Stack technologiczny

### Backend

- `nestjs`
- `prisma`
- `ai sdk`
- `bcrypt`
- `passport`
- `passport-jwt`
- `zod`
- `typescript`
- `vitest`
- `supertest`

### Frontend

Dotyczy `apps/admin` i docelowo `apps/portal`:

- `react`
- `tanstack router`
- `radix-ui`
- `tanstack query`
- `axios`
- `sonner`
- `react-hook-form`
- `date-fns`
- `clsx`
- `zod`
- `zustand`
- `playwright`
- `vitest`
- `react testing library`
- `msw`
- `typescript`
- `jsdom`
- `framer-motion`
- `tailwindcss`

## Architektura - zasady podstawowe

### 1. Monorepo i wspoldzielenie kontraktow

- Kontrakty request/response trzymamy w `packages/contracts`.
- `Zod` jest source of truth dla danych wspoldzielonych miedzy backendem i frontendem.
- Nie duplikujemy typow DTO osobno w `api` i `admin`, jesli moga byc wspoldzielone.

### 2. Auth i model uzytkownika

- Zakladamy jeden glowny model `User`.
- Uzytkownik docelowo bedzie mogl miec konto `PERSONAL` albo `COMPANY`.
- Uprawnienia administracyjne powinny byc rozdzielone od przyszlych uprawnien klienta SaaS.
- Preferowany kierunek: prosty `systemRole` dla panelu admin + gotowosc pod przyszly model kont osobistych i firmowych.
- Auth opieramy o `JWT access token + refresh token rotation`.
- Hasla zawsze hashujemy przez `bcrypt`.

### 3. Przygotowanie pod SaaS, bez przepisywania wszystkiego pozniej

Nawet jesli teraz wdrazamy tylko auth i user management, kod ma byc gotowy pod kolejne moduły:

- subskrypcje i plany cenowe
- scrapers i harmonogramy
- znormalizowane ogloszenia / zapytania
- watchlisty, alerty, zapisane filtry
- zapytania dodawane przez uzytkownikow
- AI assist przy tworzeniu zapytan
- konta osobiste i firmowe

### 4. Scraping

Scraping musi byc zaprojektowany jako osobna warstwa integracyjna:

- osobny adapter per zrodlo
- wyrazne rozdzielenie: pobranie danych, parsing, normalizacja, zapis
- idempotentny import
- logowanie runow i bledow
- mozliwosc manualnego uruchamiania scrapera z poziomu admina

Jesli scraper wymaga harmonogramu lub kolejki, preferowany jest model jobowy, a nie logika odpalana z requestu HTTP.

### 5. AI

AI ma byc warstwa wspomagajaca, nie krytyczna:

- pomoc w tworzeniu opisu zapytania
- poprawa klarownosci i kompletności ogloszenia
- sugestie tytulu, zakresu, kryteriow

Brak AI nie moze blokowac podstawowego flow aplikacji.

## Frontend - zasady

### `apps/admin`

- `TanStack Router` do routingu
- `TanStack Query` do pobierania danych
- `react-hook-form` + `zod` dla wszystkich formularzy
- `axios` jako warstwa HTTP
- `zustand` tylko dla lekkiego stanu aplikacyjnego, nie zamiast query cache

### `apps/portal`

- Poza biezacym zakresem.
- Nie tworzymy ani nie rozwijamy `apps/portal` w fazie 0 i 1, chyba ze zakres zostanie jawnie rozszerzony.

### Komponenty

- Formularze, dialogi i wieksze sekcje UI musza byc wydzielane do `src/components/`.
- Nie budujemy wszystkiego inline w route/page.
- Unikamy "AI slop" w UI. Interfejs ma byc czytelny, spójny i intencjonalny.

### Tabele w `apps/admin`

- Wszystkie widoki tabelaryczne w panelu admina musza korzystac ze wspolnego komponentu `apps/admin/components/data-table.tsx`.
- Nie tworzymy ad-hoc tabel HTML bezposrednio w `page/route`, chyba ze to tymczasowy spike i jest to jasno opisane w PR.
- Przy nowych listingach utrzymujemy jeden wzorzec: `DataTable` + fetch przez `TanStack Query`.

### React - useEffect

Efekty sa tylko do synchronizacji z systemami zewnetrznymi. Nie uzywamy `useEffect` do:

- pochodnego stanu
- prostych transformacji danych
- reakcji na klikniecie, submit lub inny event uzytkownika
- synchronizacji formularza, jesli da sie to rozwiazac przez props lub event handler

Preferowane alternatywy:

- obliczenia podczas renderu
- `useMemo`
- event handlery
- `TanStack Query`

## Backend - zasady

### NestJS

- Moduly dzielimy domenowo, np. `auth`, `users`, `scrapers`, `sources`, `notices`.
- Nie mieszamy logiki auth, users i scrapingu w jednym module.
- Walidacja ma byc oparta o `zod` lub adapter do `zod`, nie o luźne obiekty bez kontraktu.

### Prisma

- Schemat danych ma od poczatku uwzgledniac rozwoj SaaS i scraping.
- Migracje musza byc male i czytelne.
- Nie uzywamy `any` w TypeScript przy mapowaniu model -> DTO.

### Auth

- `access token` krotkozyjacy
- `refresh token` rotowany i uniewazniany po wylogowaniu / kompromitacji
- endpointy admina zabezpieczone guardami
- audyt podstawowych akcji administracyjnych

### API conventions

- Dla listingow zwracamy:
  - `{ data, meta }`
- Dla szczegolow:
  - `{ data }`
- Bledy maja byc przewidywalne i ustandaryzowane.

## Scraping - zasady domenowe

To beda wazne reguly przy wdrazaniu kolejnych etapow:

- Kazde zrodlo ma swoj stabilny `externalId`.
- Przechowujemy:
  - zrodlo
  - raw payload / snapshot
  - znormalizowany rekord
  - historie runow
- Dedupikacja nie moze opierac sie tylko na tytule.
- Musi byc mozliwosc ponownego przetworzenia wpisu po zmianie parsera.

## Testowanie

### Backend

- Serwisy: unit testy bez `TestingModule`, z recznymi mockami.
- Guardy / pipes: minimalny `TestingModule`, gdy DI ma znaczenie.
- Endpointy: `supertest` + testy integracyjne / e2e.

### Frontend

- Priorytet:
  - testy integracyjne widokow
  - testy formularzy
  - smoke e2e dla krytycznych flow
- `msw` do mockowania API w testach frontendu.

## Konwencje plikow

### Frontend

- komponenty: `PascalCase.tsx`
- hooki: `use-kebab-case.ts` lub `usePascalCase.ts` - jedna konwencja na projekt, bez mieszania
- utils: `kebab-case.ts`
- route files: zgodnie z konwencja routera wybranego w aplikacji

### Backend

- moduly: `kebab-case.module.ts`
- serwisy: `kebab-case.service.ts`
- kontrolery: `kebab-case.controller.ts`
- dto / schemas: `kebab-case.schema.ts` lub `kebab-case.dto.ts`, zaleznie od przyjetego wzorca

## Dokumentacja

- Kluczowe decyzje architektoniczne dokumentujemy w `docs/`.
- Jesli powstana wspoldzielone kontrakty, `docs/shared-zod-contracts.md` powinien opisywac realny stan projektu.
- Jesli ten plik (`AGENTS.md`) przestaje pasowac do repo, nalezy go zaktualizowac razem ze zmiana architektury.

## Obecny zakres implementacyjny

Najblizszy milestone:

1. Bootstrap monorepo na `turborepo`
2. Utworzenie `apps/api` i `apps/admin`
3. Konfiguracja wspoldzielonych pakietow (`contracts`, opcjonalnie `config` i `ui`)
4. Backend:
   - auth
   - users
   - seed pierwszego admina
   - podstawowe audytowanie
5. Admin:
   - login
   - sesja / refresh
   - lista uzytkownikow
   - tworzenie i edycja uzytkownikow
   - aktywacja / deaktywacja

Po tym etapie dopiero przechodzimy do scraperow i prezentacji ogloszen.

# Leadfinder - Plan implementacji

## 1. Cel i zakres

Budujemy platforme SaaS do agregowania zapytan ofertowych z zewnetrznych portali i udostepniania ich uzytkownikom w modelu subskrypcyjnym.

Docelowe elementy systemu:

- `apps/api` - backend
- `apps/admin` - panel administracyjny
- `apps/portal` - portal SaaS dla klientow

Aktualny zakres fazy 1:

- bootstrap monorepo
- auth w backendzie
- zarzadzanie uzytkownikami w backendzie
- panel administracyjny dla auth i user management
- bez `apps/portal` w obecnym wdrozeniu
- bez wdrazania scraperow produkcyjnych

## 2. Rekomendowana architektura repo

Rekomenduje od razu ustawic:

```text
apps/
  api/
  admin/
  portal/   # dopiero w kolejnej fazie
packages/
  contracts/
  config/
  ui/
  api-client/
docs/
```

Uwagi:

- `packages/contracts` - wspoldzielone schemy `zod`, typy request/response, enumy
- `packages/config` - wspolne `tsconfig`, lint config, env helpers
- `packages/ui` - wspoldzielone komponenty tylko wtedy, gdy faktycznie beda wspolne
- `packages/api-client` - opcjonalnie, jesli chcesz wspoldzielic klienta HTTP miedzy `admin` i `portal`

## 3. Decyzje architektoniczne, ktore warto podjac od razu

### 3.1 Package manager

Rekomendacja: `pnpm`.

Powod:

- najlepiej wspolpracuje z `turborepo`
- szybsze i bardziej przewidywalne workspaces
- nizszy koszt utrzymania monorepo niz przy `npm workspaces`

### 3.2 Model uzytkownika

Nie budowalbym osobnego modelu "admin user" i "portal user" jako dwoch roznych bytow, bo to szybko podwoi logike auth.

Rekomendacja:

- jeden model `User`
- pole `systemRole` dla dostepu do panelu admin
- przygotowanie pod konta `PERSONAL` i `COMPANY`
- przygotowanie pod przyszle `Organization` / `Membership`

Minimalny zestaw na teraz:

- `User`
- `RefreshTokenSession`
- `AuditLog`

Minimalne pola / koncepty, ktore warto przewidziec juz teraz:

- `accountType`: `PERSONAL | COMPANY`
- dane profilu konta
- miejsce pod przyszle dane firmy i ownership konta firmowego

Modele przygotowane pod przyszlosc, ale niekoniecznie wdrazane w fazie 1:

- `Organization`
- `Membership`
- `SubscriptionPlan`
- `Subscription`
- `ScraperSource`
- `ScraperDefinition`
- `ScraperRun`
- `ProcurementNotice`
- `ProcurementNoticeSource`

### 3.3 Auth

Rekomendacja:

- `access token` 15-30 min
- `refresh token` rotowany
- osobna tabela sesji refresh tokenow
- mozliwosc wymuszenia logoutu
- hashowanie hasel przez `bcrypt`

### 3.4 Scraping

Na potrzeby przyszlych etapow nie budowalbym scraperow jako "service methods" uruchamianych z requestu HTTP.

Rekomendacja:

- architektura adapterowa per portal
- job runner / scheduler
- historia runow
- raw snapshot + normalizacja
- deduplikacja po `source + externalId`

## 4. Faza 0 - bootstrap monorepo

### Cel

Przygotowac stabilny fundament pod dalsza implementacje.

### Zakres

1. Inicjalizacja `turborepo`
2. Konfiguracja workspace
3. Dodanie `apps/api` i `apps/admin`
4. Dodanie `packages/contracts`
5. Dodanie wspolnych ustawien TypeScript
6. Konfiguracja podstawowych skryptow:
   - `dev`
   - `build`
   - `test`
   - `lint`
   - `typecheck`
7. Przygotowanie `.env.example`
8. Przygotowanie `docker-compose` dla:
   - `postgres`
   - opcjonalnie `redis` pod przyszle joby

### Rezultat

- repo uruchamia sie jako monorepo
- kazda aplikacja ma czytelny punkt startowy
- kontrakty wspoldzielone maja swoje miejsce od pierwszego dnia
- `portal` pozostaje zaplanowany architektonicznie, ale nie jest wdrazany teraz

## 5. Faza 1 - backend auth i user management

### Moduly backendowe

Na start:

- `app`
- `config`
- `database`
- `auth`
- `users`
- `health`
- `audit` lub podstawowy audit wewnatrz auth/users

### Endpointy MVP

Auth:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

Users:

- `GET /users`
- `GET /users/:id`
- `POST /users`
- `PATCH /users/:id`
- `PATCH /users/:id/status`
- opcjonalnie `POST /users/:id/reset-password`

### Zakres funkcjonalny

- tworzenie administratora seedem
- logowanie admina
- odswiezanie sesji
- lista uzytkownikow z paginacja i search
- tworzenie uzytkownika
- edycja podstawowych danych
- aktywacja / deaktywacja
- podstawowy audit dzialan admina

### Kontrakty

W `packages/contracts` umiescic:

- `auth` request/response schemas
- `users` request/response schemas
- list query schemas
- podstawowe enumy typu `UserStatus`, `SystemRole`, `AccountType`

### Testy

- unit testy serwisow auth/users
- integracyjne testy endpointow auth
- integracyjne testy CRUD users
- testy przypadkow negatywnych:
  - bledne logowanie
  - brak uprawnien
  - refresh po uniewaznieniu sesji

## 6. Faza 1 - admin panel

### Widoki MVP

- `/login`
- `/`
- `/users`
- `/users/:id` lub dialog edycji

### Zakres funkcjonalny

- logowanie
- utrzymanie sesji
- odswiezanie tokenu
- guard dla tras admina
- tabela uzytkownikow
- formularz tworzenia uzytkownika
- formularz edycji uzytkownika
- zmiana statusu

### Frontend - standard implementacyjny

- routing: `TanStack Router`
- data fetching: `TanStack Query`
- formularze: `react-hook-form + zod`
- HTTP: `axios`
- toasty: `sonner`
- testy widokow: `Vitest + RTL + MSW`
- smoke e2e: `Playwright`

### Ważna decyzja

Admin panel powinien byc od razu budowany jako klient backendu kontraktowego, nie jako tymczasowy frontend "na szybko". To ograniczy przepisywanie przy `portal`.

## 7. Faza 2 - fundament pod scraping

To nie wchodzi do obecnego MVP, ale warto zaplanowac od razu modele i granice modulow.

### Backend

- `scraper-sources`
- `scraper-definitions`
- `scraper-runs`
- `procurement-notices`
- `normalizers`

### Minimalny model danych

- `ScraperSource`
- `ScraperConfig`
- `ScraperRun`
- `RawNoticeSnapshot`
- `ProcurementNotice`
- `ProcurementNoticeSourceLink`

### Wymagania architektoniczne

- kazdy scraper ma adapter z tym samym interfejsem
- run ma status, licznik rekordow, czas trwania i bledy
- rekord zrodlowy i rekord znormalizowany sa rozdzielone
- parsowanie da sie uruchomic ponownie

## 8. Faza 3 - portal SaaS dla klientow

Po zbudowaniu scraperow i danych:

- auth dla klientow
- listing ogloszen
- filtry, search, sortowanie
- widok szczegolow oferty
- zapisane wyszukiwania
- alerty / watchlisty

Na tym etapie pojawia sie realna wartosc produktowa dla abonentow.

## 9. Faza 4 - zapytania dodawane przez userow

Docelowy etap marketplace:

- klienci dodaja wlasne zapytania
- wykonawcy skladaja oferty
- porownanie ofert
- AI wspiera tworzenie czytelnego opisu
- limity i funkcje zalezne od planu subskrypcyjnego

## 10. Billing i subskrypcje

Nie wdrazalbym billingowego flow w fazie 1, ale model danych i role warto projektowac z mysla o tym, ze dojdzie:

- `SubscriptionPlan`
- `Subscription`
- `FeatureFlag` / `PlanFeature`
- usage limits

W przeciwnym razie po wdrozeniu scraperow bedzie trzeba przebudowywac auth i uprawnienia.

## 11. Ryzyka i rzeczy, na ktore trzeba uwazac

### 11.1 Scraping i zgodnosc

Trzeba od poczatku sprawdzic:

- regulaminy portali
- limity zapytan
- wymagania prawne / techniczne
- czy potrzebne sa opoznienia, proxy, retry, harmonogramy

### 11.2 Deduplikacja danych

Jedno ogloszenie moze zmieniac tresc w czasie. Sam `title` nie wystarczy do identyfikacji.

### 11.3 Rozdzielenie admin vs portal

Nie nalezy mieszac:

- ekranow wewnetrznych dla operatora platformy
- ekranow dla klienta SaaS

To sa rozne use case'y i powinny miec osobne aplikacje oraz osobne guardy.

### 11.4 AI

AI powinno byc dodatkiem. Nie projektowalbym krytycznych flow tak, zeby bez AI nie dalo sie dodac zapytania albo przejsc procesu.

## 12. Proponowana kolejnosc realizacji

1. Bootstrap monorepo
2. `packages/contracts`
3. `apps/api` - auth
4. `apps/api` - users
5. `apps/admin` - login i sesja
6. `apps/admin` - user management
7. testy i stabilizacja
8. dopiero potem architektura scrapingu

## 13. Uzgodniony zakres na teraz

Na podstawie doprecyzowania zakresu:

- package manager: `pnpm`
- realizujemy tylko faze 0 i faze 1
- `apps/portal` obecnie pomijamy
- model danych ma byc gotowy pod konta osobiste i firmowe

## 14. Definicja "done" dla obecnej fazy

Uznam etap 1 za zakonczony, gdy:

- monorepo dziala lokalnie jednym zestawem komend
- backend ma auth z refresh token rotation
- backend ma CRUD userow dla admina
- admin panel obsluguje login i user management
- kontrakty Zod sa wspoldzielone
- sa testy krytycznych flow backendu i smoke test admina

## 15. Moje uwagi do planu

- Kierunek jest sensowny, ale najwieksze ryzyko techniczne nie lezy w auth, tylko w architekturze scraperow i normalizacji danych. Dlatego warto pod nie zaprojektowac modele juz teraz, nawet jesli wdrozenie bedzie pozniej.
- Rozdzielenie `admin` i `portal` od poczatku to dobra decyzja. Unikniesz mieszania potrzeb operatora systemu z potrzebami klienta koncowego.
- Warto uproscic pierwsze MVP: bez billingow, bez AI na twardo, bez workflow dla wykonawcow. Najpierw stabilne dane, auth i panel wewnetrzny.
- Jesli chcesz "najnowsze wersje", dobrze jest unikac wpisywania sztywnych zalozen architektonicznych zaleznych od konkretnego major release. Lepiej pilnowac kontraktow i granic modulow niz wersji samych bibliotek.

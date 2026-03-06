# Leadfinder

Monorepo `pnpm + turbo` dla backendu API i panelu administracyjnego Leadfinder.

## Aplikacje

- `apps/api` - NestJS API
- `apps/admin` - React admin panel
- `packages/contracts` - wspoldzielone kontrakty Zod

## Start

1. `cp .env.example .env`
2. `pnpm install`
3. `pnpm prisma:generate`
4. `pnpm prisma:migrate`
5. `pnpm prisma:seed`
6. `pnpm dev`

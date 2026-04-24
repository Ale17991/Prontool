# Pronttu Development Guidelines

Sistema de gestão para clínicas e consultórios. Última atualização: 2026-04-23

## Active Technologies
- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, React 18.3, Radix UI, TailwindCSS 3.4 (002-ghl-optional-standalone)
- PostgreSQL via Supabase (local stack: `supabase start` :54321) com RLS por `tenant_id`. Tabelas tocadas: `tenant_ghl_config`, `patients`, `appointments`, `audit_log`, `alerts`. Nenhuma migração estrutural obrigatória (coluna `appointments.source` já aceita `'manual'` desde 0008). (002-ghl-optional-standalone)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel). (001-faturamento-medico-ghl)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test; npm run lint

## Code Style

TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel).: Follow standard conventions

## Recent Changes
- 002-ghl-optional-standalone: Added TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, React 18.3, Radix UI, TailwindCSS 3.4

- 001-faturamento-medico-ghl: Added TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel).

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

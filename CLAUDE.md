# Pronttu Development Guidelines

Sistema de gestão para clínicas e consultórios. Última atualização: 2026-04-24

## Active Technologies
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), framer-motion 12, lucide-react (003-responsive-design)
- N/A — feature de UI pura, não persiste nada (003-responsive-design)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `framer-motion` 12, `lucide-react`. (004-calendario-atendimentos)
- PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Tabelas tocadas: `appointments` (acrescenta `duration_minutes`), `tuss_codes` + `tuss_catalog_versions` (registro documental). Catálogo TUSS é leitura. (004-calendario-atendimentos)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, React 18.3, Radix UI, TailwindCSS 3.4 (002-ghl-optional-standalone)
- PostgreSQL via Supabase (local stack: `supabase start` :54321) com RLS por `tenant_id`. Tabelas de integrações multi-provider: `tenant_integrations` (source-of-truth de "o tenant está conectado?" — zero linhas = standalone), `alerts` (type `integration_sync_failed` com `detail.provider`), `audit_log` (`event_type` `integration.{connect,reconfigure,disconnect}`). Tabela legada `tenant_ghl_config` ainda é lida pelo worker de ingestão GHL — drop planejado (migration 0041 já existe como NOOP placeholder). (002-ghl-optional-standalone)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel). (001-faturamento-medico-ghl)

## Integration architecture (feature 002)

- **Plugin adapter pattern**: `src/lib/integrations/<provider>/adapter.ts` implementa `IntegrationAdapter<Config, Credentials>` (veja `src/lib/integrations/types.ts`). Registrado em `src/lib/integrations/registry.ts`. Providers hoje: `ghl` (inbound + outbound) e `generic_webhook` (outbound). Placeholders: hubspot, rdstation, pipedrive.
- **Event bus**: core publica `DomainEvent` (`patient.created`, `appointment.created`, `appointment.reversed`) via `src/lib/core/events/publish.ts`. `dispatch.ts` faz fan-out `Promise.allSettled` com timeout 5 s por adapter; falhas geram alerta `integration_sync_failed` com `detail.provider`.
- **Standalone mode**: tenant sem linha ativa em `tenant_integrations` → `getEnabledIntegrations` retorna `[]` → dispatcher retorna `[]` → zero chamadas externas, zero alertas, zero menções a providers na UI (sidebar badge fica null).
- **Inbound webhooks**: `/api/webhooks/[provider]` rota dinâmica delega para `adapter.handleInboundWebhook(supabase, req)`. `/api/webhooks/ghl` mantido como thin-forward por back-compat.
- **Credenciais**: JSON serializado e cifrado em `tenant_integrations.credentials_enc` via `enc_text_with_key`. Adapter decripta via `src/lib/core/integrations/credentials.ts`. Lint:auth rejeita `process.env.GHL_*` / `HUBSPOT_*` / etc. em arquivos de adapter.
- **Config UI**: `/configuracoes/integracoes` + `/configuracoes/integracoes/[provider]`, admin-only. Schema do form vem do `configSchema` / `credentialsSchema` do adapter serializado como JSON Schema pela rota.

## Project Structure

```text
src/
├── app/(dashboard)/            # SSR pages; layout.tsx lê getEnabledIntegrations via RLS client
├── app/api/                    # Route Handlers; cada um chama requireRole
├── lib/integrations/           # Adapters (um diretório por provider) + registry + types
├── lib/core/                   # Domain (patients, appointments, events, integrations/config+credentials)
└── lib/db/                     # Supabase clients (service vs server vs browser)

supabase/migrations/
```

## Commands

```bash
pnpm test              # vitest full suite
pnpm test:integration  # integration tests only
pnpm test:contract     # contract tests (aplicado a todo adapter)
pnpm typecheck
pnpm lint:auth         # requireRole em /api/* + adapters sem env direto
pnpm supabase:reset    # aplica todas as migrations localmente
pnpm supabase:gen-types
```

## Code Style

TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel).: Follow standard conventions

## Recent Changes
- 004-calendario-atendimentos: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `framer-motion` 12, `lucide-react`.
- 003-responsive-design: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), framer-motion 12, lucide-react

- 002-ghl-optional-standalone: adapter registry multi-plataforma + event bus + standalone parity. GHL passa a ser um plugin; outros providers podem entrar sem tocar em core.


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

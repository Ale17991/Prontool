# Prontool Development Guidelines

Sistema de gestão para clínicas e consultórios. Última atualização: 2026-04-27

## Active Technologies
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), framer-motion 12, lucide-react (003-responsive-design)
- N/A — feature de UI pura, não persiste nada (003-responsive-design)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `framer-motion` 12, `lucide-react`. (004-calendario-atendimentos)
- PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Tabelas tocadas: `appointments` (acrescenta `duration_minutes`), `tuss_codes` + `tuss_catalog_versions` (registro documental). Catálogo TUSS é leitura. (004-calendario-atendimentos)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui, `date-fns` 4.1, Pino 9. (005-agenda-plano-integracao)
- PostgreSQL via Supabase. **Nova extensão**: `btree_gist` (no schema `extensions`) para suportar EXCLUDE com `=` em UUIDs + `&&` em `tstzrange`. Tabelas tocadas: `appointments` (sem mudança de colunas — só novos triggers/índices), `appointment_reversals` (apenas leitura por trigger novo), `treatment_plan_steps` (acrescenta `appointment_id` via column-guard relaxado para essa coluna no INSERT). Tabelas novas: `appointment_completions`, `appointment_slot_locks`. (005-agenda-plano-integracao)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui, `lucide-react`, `date-fns` 4.1. (006-comprovantes-particular)
- PostgreSQL via Supabase + Supabase Storage. Tabelas tocadas: `appointments` (ALTER `plan_id` para nullable), `expenses` (3 colunas legadas mantidas até 0060), `audit_log` (uso, sem schema change). Tabelas novas: `expense_receipts`. Bucket: `expense-receipts` (já criado em 0058). (006-comprovantes-particular)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `lucide-react`, Pino 9 (007-linguagem-simples-materiais-whatsapp)
- PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Próxima migration: **`0061_appointment_materials.sql`**. Tabelas tocadas: nova `appointment_materials`; tabela existente `tuss_codes` (somente leitura, filtro `tuss_table='19'`); `audit_log` (uso, sem schema change). Sem mudanças em banco para Features 2 e 3. (007-linguagem-simples-materiais-whatsapp)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (schemas OAuth + payloads webhook), Pino 9, React 18.3, shadcn/ui (Radix), TailwindCSS 3.4. **Sem novas deps de runtime** — `fetch` nativo + `AbortSignal.timeout(5000)` para chamadas GHL; `crypto.randomUUID` + `crypto.timingSafeEqual` para state/csrf e verificação de assinatura. (008-ghl-marketplace-oauth)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Tabelas tocadas**: `tenant_integrations` (acrescenta colunas `status TEXT`, `connected_at TIMESTAMPTZ`, `location_id TEXT GENERATED ALWAYS AS (config->>'location_id') STORED` para índice unique), `audit_log` (uso, sem schema change), `alerts` (uso). **Tabelas novas**: `integration_sync_log` (append-only, retenção das últimas 10 entradas por tenant×provider via trigger). **Migration nova**: `0062_ghl_oauth_marketplace.sql`. Catálogo de custom fields é dado externo (sub-account GHL) — IDs persistidos em `tenant_integrations.config.custom_field_ids`. (008-ghl-marketplace-oauth)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin` via Service Role), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` 3.4 (já presente — receberá o novo header). **Sem novas deps de runtime** — ViaCEP via `fetch` nativo com `AbortSignal.timeout(3000)`; validação de CNPJ feita por helper puro local; máscaras com `react-input-mask` opcional ou implementação inline (preferível inline para evitar nova dep). (009-configuracoes-clinica-equipe)
- PostgreSQL via Supabase (local `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0064_clinic_profile_and_team_management.sql`. **Tabelas tocadas**: `user_tenants` (acrescenta `status`, `disabled_at`, `disabled_by`); `audit_log` (uso, sem schema change). **Tabelas novas**: `tenant_clinic_profile`, `user_profile`. **Buckets novos**: `clinic-logos` (privado, leitura por mesmo tenant via RLS em `storage.objects`), `user-avatars` (privado, leitura para autenticados do mesmo tenant). Funções DB novas: `is_last_active_admin(tenant_id, user_id)` e trigger `enforce_last_admin` em `user_tenants`. (009-configuracoes-clinica-equipe)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `date-fns` 4.1, `lucide-react`. **Sem novas deps de runtime**. Para o calendário usamos `date-fns` (já em deps) — para semana/mês/range; mini-calendário é componente próprio (não há libs no projeto que façam render de mês compacto, e adicionar uma só para isso é overkill). (010-multi-tenant-ghl-calendar)
- PostgreSQL via Supabase (local `supabase start` :54321). **Migration nova**: `0065_active_tenant_and_signup.sql`. **Tabelas tocadas**: nenhuma alteração de schema em `tenants`, `tenant_integrations` ou `user_tenants` (todos os FRs se apoiam nas estruturas existentes). **Tabela nova**: `user_active_tenant` (1:1 com `auth.users`, persiste última clínica usada). **Função nova**: `create_first_tenant(p_user_id, p_name, p_slug, p_cnpj, p_phone)` SECURITY DEFINER — atomicidade da criação onboarding (insert tenants + insert user_tenants admin + insert user_active_tenant). **Função alterada**: `auth_hook_custom_claims` recebe nova prioridade de leitura `user_active_tenant`. (010-multi-tenant-ghl-calendar)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`, Pino 9. **Sem novas deps**. (011-cadastro-impostos)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0076_taxes_and_plan_tax_rate.sql` cria `public.taxes`, acrescenta `health_plans.tax_rate_bps`, acrescenta `expenses.tax_id`. Triggers de append-only e audit usam o padrão existente (`enforce_append_only`, `log_audit_event`, `session_uuid('app.actor_id')`). (011-cadastro-impostos)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin.createUser`), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1. **Sem novas deps**. (012-tarefas-notificacoes-usuarios)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0078_tasks_notifications_user_link.sql`. **Tabelas novas**: `public.tasks`, `public.notifications`. **Tabela alterada**: `public.doctors` (adiciona `user_id UUID NULL` + UNIQUE parcial `(tenant_id, user_id) WHERE user_id IS NOT NULL`). **RPC nova**: `generate_user_notifications(p_tenant_id UUID, p_user_id UUID) RETURNS jsonb` (SECURITY DEFINER) — gera lazy as 4 categorias usando UPSERT com `ON CONFLICT DO NOTHING` sobre UNIQUE natural key. (012-tarefas-notificacoes-usuarios)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1, Pino 9. **Sem novas deps**. (013-modalidades-pagamento-assistente)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`. **Sem novas deps** — usa apenas o que já está no projeto. (014-sidebar-config-hub)
- N/A — feature pura de UI; nenhuma migration, RLS, função SQL ou bucket é tocado. (014-sidebar-config-hub)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, React 18.3, Radix UI, TailwindCSS 3.4 (002-ghl-optional-standalone)
- PostgreSQL via Supabase (local stack: `supabase start` :54321) com RLS por `tenant_id`. Tabelas de integrações multi-provider: `tenant_integrations` (source-of-truth de "o tenant está conectado?" — zero linhas = standalone), `alerts` (type `integration_sync_failed` com `detail.provider`), `audit_log` (`event_type` `integration.{connect,reconfigure,disconnect}`). Tabela legada `tenant_ghl_config` ainda é lida pelo worker de ingestão GHL — drop planejado (migration 0041 já existe como NOOP placeholder). (002-ghl-optional-standalone)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel). (001-faturamento-medico-ghl)

## Integration architecture (features 002, 008)

- **Plugin adapter pattern**: `src/lib/integrations/<provider>/adapter.ts` implementa `IntegrationAdapter<Config, Credentials>` (veja `src/lib/integrations/types.ts`). Registrado em `src/lib/integrations/registry.ts`. Providers hoje: `ghl` (inbound + outbound) e `generic_webhook` (outbound). Placeholders: hubspot, rdstation, pipedrive.
- **Event bus**: core publica `DomainEvent` (`patient.created`, `appointment.created`, `appointment.reversed`) via `src/lib/core/events/publish.ts`. `dispatch.ts` faz fan-out `Promise.allSettled` com timeout 5 s por adapter; falhas geram alerta `integration_sync_failed` com `detail.provider`.
- **Standalone mode**: tenant sem linha ativa em `tenant_integrations` → `getEnabledIntegrations` retorna `[]` → dispatcher retorna `[]` → zero chamadas externas, zero alertas, zero menções a providers na UI (sidebar badge fica null).
- **Inbound webhooks**: `/api/webhooks/[provider]` rota dinâmica delega para `adapter.handleInboundWebhook(supabase, req)`. `/api/webhooks/ghl` mantido como thin-forward por back-compat.
- **Credenciais**: JSON serializado e cifrado em `tenant_integrations.credentials_enc` via `enc_text_with_key`. Adapter decripta via `src/lib/core/integrations/credentials.ts`. Lint:auth rejeita `process.env.GHL_*` / `HUBSPOT_*` / etc. em arquivos de adapter.
- **Config UI**: `/configuracoes/integracoes` + `/configuracoes/integracoes/[provider]`, admin-only. Schema do form vem do `configSchema` / `credentialsSchema` do adapter serializado como JSON Schema pela rota.

### Feature 008 — GHL Marketplace OAuth 2.0 (extensão)

- **Cápsula `oauth/`** em `src/lib/integrations/ghl/oauth/` é o **único** lugar autorizado a ler `process.env.GHL_CLIENT_ID/SECRET/REDIRECT_URI/SCOPES/MARKETPLACE_SHARED_SECRET/SSO_*`. Adapter (`adapter.ts`, `create-contact.ts`, `create-note.ts`, `update-contact.ts`) recebe `accessToken` via `withGhlAuth(supabase, tenantId)` que faz auto-refresh com CAS sobre `updated_at` (sem advisory lock, incompatível com pgBouncer transaction-mode).
- **Marketplace lifecycle**: `/api/oauth/ghl/{authorize,callback,refresh}` para conexão manual; `/api/webhooks/ghl/{install,uninstall}` (HMAC-SHA256 + janela ±5min) para o Marketplace. Ambos convergem em `connectGhlTenant`/`disconnectGhlTenant` em `src/lib/core/integrations/ghl/`.
- **Post-connect setup**: `runPostConnectSetup` (em `src/lib/core/integrations/ghl/post-connect-setup.ts`) orquestra `customFieldsSetup` (6 fields, sufixa "(Prontool)" em colisão de tipo) + `webhooksSetup` (3 hooks) + `customMenuSetup` (best-effort). Roda fire-and-forget em produção, `await` em testes.
- **Tabela `integration_sync_log`** (migration 0062) é append-only com RLS read-only-tenant; populada via `recordSyncSuccess/Failure` em `src/lib/core/integrations/ghl/sync-log.ts` com PII mascarada (`mask-pii.ts`). UI lê últimas 10 entradas em `/configuracoes/integracoes/ghl`.
- **SSO/Custom Menu** (US5): `/api/sso/ghl` valida JWT contexto via JWKS (`verify-sso-token.ts` — RS256 com `crypto.createPublicKey({format:'jwk'})`, sem `jose`). Auto-login completo (mintar JWT Supabase) é follow-up.

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
- 014-sidebar-config-hub: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`. **Sem novas deps** — usa apenas o que já está no projeto.
- 013-modalidades-pagamento-assistente: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1, Pino 9. **Sem novas deps**.
- 012-tarefas-notificacoes-usuarios: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin.createUser`), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1. **Sem novas deps**.



<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

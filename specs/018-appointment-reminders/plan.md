# Implementation Plan: Motor de lembretes automáticos de consulta — email (Fase 1)

**Branch**: `018-appointment-reminders` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-appointment-reminders/spec.md`

## Summary

Motor de lembretes automáticos por email para reduzir no-show. Job recorrente (a cada 15min) seleciona agendamentos dentro da janela da antecedência configurada, valida elegibilidade (tenant habilitado, paciente com email + opt-in, agendamento não estornado, janela de horário permitido) e envia email via Resend (provedor já configurado). Cada envio cria registro append-only em `appointment_reminders` (status sent/failed/skipped\_\*) com idempotência via UNIQUE `(appointment_id, scheduled_offset_hours, channel)`. Batch limitado a 200/ciclo conforme clarificação Q1. Reenvio manual permitido em qualquer status (Q2). Email contém link para landing pública da clínica quando a feature 017 está habilitada (Q3). Dados de profissional/procedimento refletem estado vigente no momento do envio (Q4).

Reusa pattern de adapter de integrações (`src/lib/integrations/`) para futuramente plugar canais (WhatsApp, SMS) sem refatorar core.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router + Server Actions + RSC), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (validação payload), Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1 + `date-fns-tz` (já presente — fuso da clínica), Pino 9 (observabilidade), Resend (já presente — `resend-client.ts`). **Sem novas deps de runtime.**
**Storage**: PostgreSQL via Supabase (local stack: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0094_appointment_reminders.sql`. **Tabelas tocadas**: `tenant_clinic_profile` (acrescenta 6 colunas de configuração de lembrete + 1 coluna histórica de último ciclo), `patients` (acrescenta `reminders_opt_in BOOLEAN DEFAULT TRUE`), `audit_log` (uso via `log_audit_event`, sem schema change). **Tabela nova**: `appointment_reminders` (append-only com trigger anti-update fora do path `queued→sent/failed`). **Sem mudanças em RLS de tabelas existentes** (só adiciona policies novas para as colunas e tabela acrescentadas).
**Testing**: Vitest 1.6 (unit + contract); Playwright reservado para smoke de UI no Phase 8 (não obrigatório nesta fase).
**Target Platform**: Vercel (Next.js Edge para SSR pages, Node runtime para a rota de cron e workers).
**Project Type**: Web app monorepo (Next.js — único projeto, sem split frontend/backend).
**Performance Goals**: Ciclo completo do cron termina em ≤30s (limite Vercel Cron free); idempotência sob retry do cron; 200 envios concorrentes via `Promise.allSettled` (Resend SDK suporta concorrência mas com rate limit interno — config Resend já no plano).
**Constraints**: Time budget 30s no cron Vercel; Resend rate limit (free tier 10 req/s, plano atual 100 req/s); LGPD — email do paciente **MUST NOT** aparecer em logs em texto claro (Pino com redaction); valores de auditoria em UTC (Princípio II — constitucional).
**Scale/Scope**: Estimativa — até 1000 clínicas ativas com média 5 lembretes/dia = ~150k emails/mês. Provedor Resend atual suporta com upgrade futuro de plano (decisão operacional, não bloqueia rollout).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                        | Aplica?    | Como atendemos                                                                                                                                                                                                                                                                                                                                                                                | Status                      |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **I. Imutabilidade financeira**  | Indireto   | `appointment_reminders` é tabela operacional (não financeira), mas é tratada como **append-only** por consistência arquitetural: nunca `DELETE`, `UPDATE` apenas para transitar `queued→sent/failed` via trigger anti-mutation fora do path autorizado. Não toca `appointments`, `appointment_reversals`, `price_versions` etc.                                                               | ✅ PASS                     |
| **II. Auditabilidade total**     | Sim        | Cada envio (sent, failed, skipped\_\*) chama `log_audit_event` com `tenant_id`, `actor` (system para cron / user para manual), `entity='appointment_reminders'`, `entity_id`, `field`, `new_value=status`, `reason`. Trigger de audit em `appointment_reminders` espelha o padrão existente em `public_booking_doctors` (migration 0093).                                                     | ✅ PASS                     |
| **III. Isolamento multi-tenant** | Sim — GATE | RLS por `tenant_id` em `appointment_reminders` (anon: nenhum acesso; authenticated: leitura por jwt_tenant_id; write apenas via service-role). Cron usa service-role com filtro explícito por `tenant_id` em cada query. **Teste de contrato obrigatório**: cron de tenant A NUNCA seleciona/grava em registros de tenant B. Idempotência também respeita o `tenant_id` na UNIQUE constraint. | ✅ PASS (com gate de teste) |
| **IV. Conformidade TUSS/ANS**    | N/A        | Feature não toca catálogo TUSS, códigos de procedimento, faturas, integrações TISS. Procedimento aparece no email apenas como `display_name` (já modelado).                                                                                                                                                                                                                                   | ✅ N/A                      |
| **V. RBAC server-side**          | Sim        | `requireRole(['admin', 'recepcionista'])` na rota `/configuracoes/lembretes` (server action) e na rota de reenvio manual `/api/lembretes/[id]/reenviar`. Cron autenticado via `CRON_SECRET` header (pattern existente em `/api/workers/process-ghl-event`). Profissional de saúde **NÃO** pode editar configuração (FR-006).                                                                  | ✅ PASS                     |

**Constitutional gates** todos verdes. Nenhuma violação a justificar em "Complexity Tracking".

Compromissos da constituição que afetam plano (não-violações, só requisitos):

- Migration revisada por mantenedor com conhecimento de domínio antes do merge (rule `Restrições de Domínio`).
- Teste de contrato `tests/contract/reminders-tenant-isolation.spec.ts` é **gate de merge**.
- Email do paciente em logs: usar `redactor` do Pino para mascarar `*@*` em qualquer campo log.
- Moeda: N/A (feature não toca valores monetários).

## Project Structure

### Documentation (this feature)

```text
specs/018-appointment-reminders/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification (already exists)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── cron-send-reminders.contract.md
│   ├── action-save-config.contract.md
│   └── api-reenviar-lembrete.contract.md
├── checklists/
│   └── requirements.md  # Already exists
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   └── configuracoes/
│   │       └── lembretes/                    # US1, US3 — UI admin
│   │           ├── page.tsx                  # Server: lê config + histórico + próximos
│   │           ├── actions.ts                # Server actions: saveConfig, manualResend
│   │           ├── config-form.tsx           # Client: toggle, offsets, janela, template
│   │           └── history-table.tsx         # Client: listagem + paginação + botão reenviar
│   ├── (dashboard)/operacao/pacientes/[id]/
│   │   └── reminders-opt-in-toggle.tsx       # US4 — opt-in/opt-out per paciente (add to existing patient profile page)
│   └── api/
│       ├── cron/send-reminders/
│       │   └── route.ts                      # US2 — POST cron handler (autenticado via CRON_SECRET)
│       └── lembretes/[id]/reenviar/
│           └── route.ts                      # US3 — POST manual resend (requireRole)
├── lib/
│   ├── core/
│   │   └── reminders/                        # Core domain (server-only)
│   │       ├── types.ts                      # DTOs: ReminderSettings, ReminderRecord, etc
│   │       ├── config.ts                     # CRUD + Zod schemas (US1)
│   │       ├── select-due.ts                 # Query: agendamentos elegíveis no ciclo (US2)
│   │       ├── send-one.ts                   # Envia 1 lembrete + grava registro + audit
│   │       ├── process-batch.ts              # Orquestra batch ≤200, Promise.allSettled
│   │       ├── opt-in.ts                     # Read/write reminders_opt_in em patients
│   │       └── render-email.ts               # Substitui placeholders no template
│   └── integrations/
│       └── email/
│           └── reminder-template.ts          # Template HTML default (paciente)
└── components/                               # (sem componentes específicos a criar — usa shadcn primitives)

supabase/migrations/
└── 0094_appointment_reminders.sql            # Migration única

tests/
├── contract/
│   ├── reminders-tenant-isolation.spec.ts    # GATE constitucional III
│   ├── reminders-rbac.spec.ts                # GATE constitucional V
│   └── reminders-idempotency.spec.ts         # GATE feature (UNIQUE)
├── integration/
│   ├── reminders-cron-flow.spec.ts           # E2E do ciclo (resend mockado)
│   ├── reminders-opt-out.spec.ts             # Paciente opt-out → skipped
│   └── reminders-manual-resend.spec.ts       # US3
└── unit/
    ├── reminders-render-email.spec.ts        # placeholders + escape
    ├── reminders-select-due.spec.ts          # janela, fuso, fim de semana
    └── reminders-config-schema.spec.ts       # Zod validations
```

**Structure Decision**: web app monorepo (Next.js — único projeto). Convenções existentes: `src/app/(dashboard)/...` para rotas admin com auth, `src/app/api/...` para route handlers, `src/lib/core/<domain>/` para lógica server-side com Supabase client injetado, `src/lib/integrations/<provider>/` para adapters externos. Padrão de adapter (registry) reusado para futuro WhatsApp/SMS (Fase 2) sem refatoração estrutural.

## Phase 0: Outline & Research

Ver [research.md](./research.md) — 8 decisões técnicas catalogadas.

Resumo dos pontos cobertos:

1. **Vercel Cron vs scheduler externo** → Vercel Cron (já no projeto via `vercel.json`)
2. **Batch processing**: `Promise.allSettled` com cap de 200 itens
3. **Idempotência**: `INSERT ... ON CONFLICT (appointment_id, scheduled_offset_hours, channel) DO NOTHING`
4. **Retry de provedor**: nenhum automático Fase 1; admin reenvia manual
5. **Template storage**: TEXT em `tenant_clinic_profile`; render server-side com escape HTML
6. **TZ por tenant**: `date-fns-tz` já presente; janela interpretada em `America/Sao_Paulo` default
7. **Auth do cron**: header `Authorization: Bearer ${CRON_SECRET}` (pattern existente)
8. **Email do paciente em logs**: Pino redactor `paths: ['*.email', 'patient.email']`

## Phase 1: Design & Contracts

**Prerequisites:** [research.md](./research.md) complete

### Data model

Ver [data-model.md](./data-model.md) — 1 tabela nova + 2 ALTERs + state diagram.

Resumo:

- `appointment_reminders` (id, tenant_id, appointment_id, scheduled_offset_hours, channel, status, error, provider_message_id, is_manual, created_at, sent_at)
- ALTER `tenant_clinic_profile` (+7 colunas de configuração)
- ALTER `patients` (+1 coluna `reminders_opt_in`)
- Trigger `audit_appointment_reminders_change` (audit on INSERT/UPDATE/DELETE)
- Trigger `appointment_reminders_immutable` (rejeita UPDATE de status fora do path queued→sent/failed)
- 5 índices (lookup por tenant+window, idempotência UNIQUE, audit support)

### Contracts

Ver `contracts/`:

- [cron-send-reminders.contract.md](./contracts/cron-send-reminders.contract.md) — POST `/api/cron/send-reminders`
- [action-save-config.contract.md](./contracts/action-save-config.contract.md) — Server Action `saveReminderConfig`
- [api-reenviar-lembrete.contract.md](./contracts/api-reenviar-lembrete.contract.md) — POST `/api/lembretes/[id]/reenviar`

### Quickstart

Ver [quickstart.md](./quickstart.md) — passo-a-passo de validação end-to-end (Docker + supabase + .env + smoke).

### Agent context update

Rodando `update-agent-context.ps1 -AgentType claude` ao final para registrar as novas tecnologias usadas (nenhuma dep nova, mas registrar a tabela `appointment_reminders` + migration 0094).

## Constitution Re-check (post Phase 1)

Após desenhar data-model + contracts:

- **I**: nenhuma mutação destrutiva em tabelas financeiras; reminders separados; trigger anti-mutation reforça append-only. ✅
- **II**: cada operação (INSERT em reminders, UPDATE de status, INSERT em config, manual resend) tem audit via trigger e/ou chamada explícita a `log_audit_event`. ✅
- **III**: RLS em `appointment_reminders` filtra por `jwt_tenant_id()`; cron filtra por `tenant_id` explícito em cada SELECT; teste de contrato é gate. UNIQUE composta inclui implicitamente o tenant via FK. ✅
- **IV**: N/A. ✅
- **V**: RBAC nas Server Actions + route handler de reenviar; cron usa CRON_SECRET; lint:auth do projeto valida `requireRole` em `/api/*`. ✅

Nenhum item de "Complexity Tracking" a registrar — todos os princípios atendidos sem desvios.

## Complexity Tracking

> Nenhuma violação constitucional. Seção vazia intencionalmente.

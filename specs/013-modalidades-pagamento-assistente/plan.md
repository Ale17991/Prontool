# Implementation Plan: Modalidades de pagamento + Profissional assistente

**Branch**: `013-modalidades-pagamento-assistente` | **Date**: 2026-05-14 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-modalidades-pagamento-assistente/spec.md`

## Summary

Três entregas coordenadas numa fatia única, sobrepostas ao modelo financeiro existente sem retroatividade:

1. **Cadastro de modalidades (US1, P1)** — nova ENUM `payment_mode` ∈ {comissionado, fixo, liberal} em `doctors`, com **default `comissionado`** para retrocompatibilidade total (FR-008/SC-002). Parâmetros financeiros versionados em nova tabela `doctor_payment_terms_history` (append-only, mirror do padrão `doctor_commission_history`/0005), seedada com 1 row por doctor existente. UI de cadastro/edição renderiza campos dinamicamente. RBAC admin-only.
2. **Profissional assistente no atendimento (US2, P2)** — nova tabela `appointment_assistants` append-only com `removed_at`/`removed_by` para soft-unlink (Constitution I), `frozen_amount_cents` no INSERT (FR-014). Trigger valida (a) tenant consistency, (b) `assistant_doctor_id` tem `payment_mode='liberal'` no momento do insert (defense in depth), (c) impede duplicata ativa. UI nos formulários de novo/editar atendimento + visualização. Badge "(+ N assistentes)" no calendário.
3. **Impacto em relatórios (US3, P3)** — view virtualizada `monthly_fixed_pay_lines(tenant_id, doctor_id, year, month, billing_date, amount_cents)` gera linhas de pagamento fixo _a partir_ do dia de faturamento de cada mês, sem job/agendador. Relatórios `/relatorios/mensal`, `/relatorios/por-profissional/[doctorId]` e o resultado operacional consomem a view + agregam `appointment_assistants` (com filtro `removed_at IS NULL` + exclusão de estornados, FR-019/FR-022).

Stack inalterada: Next.js 14 (App Router), Supabase PostgreSQL com RLS, Zod, Tailwind, shadcn/ui. **Nenhuma nova dependência runtime**. Migration `0084_payment_modes_and_assistants.sql`.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1, Pino 9. **Sem novas deps**.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`.

- **Migration nova**: `0084_payment_modes_and_assistants.sql` (única — agrupa todos os deltas).
- **ENUM novo**: `public.payment_mode` ∈ {`comissionado`, `fixo`, `liberal`}.
- **Tabela alterada**: `public.doctors` (acrescenta `payment_mode payment_mode NOT NULL DEFAULT 'comissionado'` + índice `(tenant_id, payment_mode)`).
- **Tabelas novas**: `public.doctor_payment_terms_history` (append-only, FK em `doctors`, CHECK por modalidade, RLS por tenant), `public.appointment_assistants` (append-only com `removed_at`, RLS por tenant, FK em `appointments` e `doctors`).
- **View nova**: `public.doctor_payment_terms_current` (head-of-chain por doctor — DISTINCT ON), `public.monthly_fixed_pay_lines` (virtualiza linhas mensais a partir do `billing_day` configurado, computadas on-demand sobre `generate_series` do mês corrente/anterior).
- **Triggers**: append-only enforcement em ambas as tabelas novas; tenant consistency em `appointment_assistants`; validação de modalidade liberal; audit em INSERT/UPDATE (`removed_at` set).
- **Backfill**: seed inicial — 1 row em `doctor_payment_terms_history` por doctor existente, com `payment_mode='comissionado'` e `percentage_bps` herdado da linha atual de `doctor_commission_history` (DISTINCT ON head).
  **Testing**: Vitest (unit + integration). Stack Supabase local (`supabase start`) obrigatório. Contract tests em `tests/contract/` (RBAC, tenant isolation, imutabilidade). Integration em `tests/integration/`.
  **Target Platform**: Vercel (`runtime = 'nodejs'` para rotas que tocam DB).
  **Project Type**: web — App Router monolítico.
  **Performance Goals**:
- SC-001: cadastro de profissional Fixo completo (modalidade + valor + dia) em < 2 minutos (UX/perceived performance — sem requisitos de TPS).
- SC-007: adição de assistente em atendimento < 30 s (carga do seletor de liberais ≤ 300 ms — query simples sobre `doctors WHERE active AND payment_mode='liberal'`).
- View `monthly_fixed_pay_lines`: < 200 ms para tenant com ≤ 20 Fixos (degrau cabe nos índices existentes).
- Relatório por profissional Liberal com participações: < 500 ms para tenant com ≤ 1000 atendimentos/mês.
  **Constraints**:
- **Append-only parcial (Constitution I)**: `doctor_payment_terms_history` é append-only stricto — toda mudança de modalidade insere nova versão com `valid_from`. `appointment_assistants` é append-only stricto também — remoção marca `removed_at` (single mutation permitida, audit obrigatório), nunca DELETE.
- **Auditabilidade (Constitution II)**: trigger `audit_doctor_payment_terms_change` registra cada nova versão; trigger `audit_appointment_assistant_change` registra INSERT (adição) e UPDATE de `removed_at` (remoção). Mudança de `doctors.payment_mode` também audita.
- **Isolamento multi-tenant (Constitution III)**: RLS por `tenant_id` em ambas as tabelas novas; tenant consistency em `appointment_assistants` via trigger; UNIQUE `(appointment_id, assistant_doctor_id) WHERE removed_at IS NULL` previne duplicata ativa.
- **Moeda (Constitution Domain Restrictions)**: todos os valores em `INTEGER cents` (BRL), nunca `float`. Conversões UI usam helpers já existentes (`formatCurrency`).
- **RBAC server-side (Constitution V)**: `requireRole(['admin'])` em rotas de mudança de modalidade/parâmetros financeiros. Criação de atendimento com assistente herda os roles existentes (`admin`, `recepcionista`).
- **TUSS/ANS (Constitution IV)**: ➖ N/A — feature não toca catálogo TUSS, procedimentos nem TISS.
- **Dia de faturamento 1–28**: CHECK constraint no banco; UI restringe seletor.
  **Scale/Scope**: ~20 profissionais/tenant (≤ 5 Liberais), ~1000 atendimentos/mês em pico, ≤ 5 assistentes por atendimento. Cabe no envelope atual sem otimização adicional.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                               | Status    | Como esta feature cumpre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável (NON-NEGOTIABLE)** | ✅ Cumpre | `doctor_payment_terms_history` é append-only stricto — cada mudança de modalidade ou parâmetro insere nova versão (`valid_from`); UPDATE/DELETE bloqueados via trigger `enforce_payment_terms_immutable`. `appointment_assistants` permite só mutação de `removed_at`/`removed_by` (representação de "deixou de participar"); demais colunas imutáveis após INSERT. `frozen_amount_cents` congelado no INSERT do assistente (FR-014) — mudanças futuras no valor padrão do liberal não retroagem. Estorno do atendimento principal NÃO modifica registros de assistente (FR-019); o relatório apenas filtra pelo status do pai.         |
| **II. Auditabilidade Total de Preços (NON-NEGOTIABLE)** | ✅ Cumpre | `audit_doctor_payment_terms_insert` (AFTER INSERT em history) registra `{previous_mode, new_mode, params}` + ator/timestamp via `log_audit_event`. `audit_appointment_assistant_change` (AFTER INSERT e AFTER UPDATE de `removed_at`) registra adição/remoção. Mudança de `doctors.payment_mode` audita via trigger `audit_doctors_payment_mode` (AFTER UPDATE OF payment_mode). Audit log inclui `reason` obrigatório (`TEXT CHECK char_length>=3`) — UI captura via campo "Motivo da mudança" no editor de modalidade.                                                                                                                |
| **III. Isolamento Multi-Tenant**                        | ✅ Cumpre | `doctor_payment_terms_history.tenant_id NOT NULL REFERENCES tenants(id)` + RLS `payment_terms_read_tenant` (`tenant_id = jwt_tenant_id()`). `appointment_assistants.tenant_id NOT NULL` + RLS `assistants_read_tenant`. Trigger `check_assistant_tenant_consistency` (BEFORE INSERT) valida `assistant.tenant_id = appointment.tenant_id AND assistant.tenant_id = doctor.tenant_id`. UNIQUE parcial `(appointment_id, assistant_doctor_id) WHERE removed_at IS NULL` bloqueia duplicata dentro do mesmo tenant. Testes em `tests/contract/appointment-assistants-tenant-isolation.spec.ts` e `payment-terms-tenant-isolation.spec.ts`. |
| **IV. Conformidade TUSS/ANS**                           | ➖ N/A    | Feature não toca catálogo TUSS, procedimentos ou integrações TISS/ANS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **V. Segurança por Perfil de Acesso (RBAC)**            | ✅ Cumpre | `requireRole(['admin'])` em `POST /api/medicos/[id]/payment-mode` e `PATCH /api/medicos/[id]` (mudança de modalidade/parâmetros). Outros papéis (`financeiro`, `recepcionista`, `profissional_saude`) podem ler via GET `/api/medicos` (RLS aplica filtro tenant). Criação de atendimento com assistente: `requireRole(['admin','recepcionista'])` (mesmos papéis que criam atendimento). Relatórios: `requireRole(['admin','financeiro'])` (mesmos atuais). Mudança de modalidade negada para não-admins **MUST** logar via `log_audit_event` (`field='auth_denied'`).                                                                 |

**Gate de complexity tracking**: nenhum desvio justificável necessário — feature usa exatamente os padrões estabelecidos (append-only history + RLS + audit + `requireRole` + ENUM no schema).

## Project Structure

### Documentation (this feature)

```text
specs/013-modalidades-pagamento-assistente/
├── plan.md              # This file
├── research.md          # Phase 0 — decisões resolvidas (10 decisões)
├── data-model.md        # Phase 1 — schema SQL + invariantes + diagrama
├── quickstart.md        # Phase 1 — passo-a-passo dev + smoke por US
├── contracts/
│   ├── api-medicos-payment-mode.md     # PATCH /api/medicos/[id] (estende existente)
│   ├── api-atendimentos-assistants.md  # POST /api/atendimentos/manual c/ assistants[]
│   └── api-relatorios-deltas.md        # Deltas em /api/relatorios/{mensal,por-profissional,resultado-operacional}
├── checklists/
│   └── requirements.md  # já existente (fase /speckit-specify)
└── tasks.md             # gerado por /speckit-tasks
```

### Source Code (repository root)

A feature reaproveita 100% a estrutura existente; abaixo apenas os caminhos tocados.

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── configuracoes/
│   │   │   └── profissionais/
│   │   │       ├── new-doctor-form.tsx       # ALT — seletor de modalidade + campos dinâmicos
│   │   │       ├── page.tsx                  # ALT — coluna "Modalidade" + coluna "Valor" adaptada
│   │   │       └── [id]/
│   │   │           ├── page.tsx              # ALT — editor de modalidade c/ histórico
│   │   │           └── payment-mode-editor.tsx  # NOVO — client (form para trocar modalidade)
│   │   ├── operacao/
│   │   │   ├── atendimentos/
│   │   │   │   ├── novo/
│   │   │   │   │   └── new-appointment-form.tsx   # ALT — campo "Profissional assistente"
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── page.tsx                   # ALT — exibe lista de assistentes
│   │   │   │   │   └── assistants-editor.tsx      # NOVO — client (add/remove em atendimento já salvo)
│   │   │   │   └── components/
│   │   │   │       └── assistant-multi-select.tsx # NOVO — client (multi-select liberais)
│   │   │   └── agenda/
│   │   │       └── appointment-block.tsx          # ALT — indicador "(+ N assistentes)"
│   │   └── analise/
│   │       └── relatorios/
│   │           ├── mensal/page.tsx                # ALT — linhas de pagamento fixo
│   │           ├── por-profissional/[doctorId]/page.tsx  # ALT — branches por modalidade
│   │           └── resultado-operacional/page.tsx # ALT — fórmula completa
│   ├── api/
│   │   ├── medicos/
│   │   │   ├── route.ts                           # ALT — POST aceita payment_mode + params
│   │   │   └── [id]/
│   │   │       ├── route.ts                      # ALT — PATCH altera modalidade c/ audit
│   │   │       └── payment-terms/
│   │   │           └── route.ts                  # NOVO — GET histórico, POST nova versão
│   │   ├── atendimentos/
│   │   │   ├── manual/route.ts                   # ALT — aceita assistants[]
│   │   │   └── [id]/
│   │   │       └── assistants/route.ts           # NOVO — POST add, PATCH remove (soft)
│   │   └── relatorios/
│   │       ├── mensal/route.ts                   # ALT — agrega fixed pay lines
│   │       ├── por-profissional/[doctorId]/route.ts  # ALT — branches por mode
│   │       └── resultado-operacional/route.ts    # NOVO ou ALT (existe?) — fórmula completa
├── lib/
│   ├── auth/
│   │   └── rbac.ts                                # ALT — action `doctor.payment_mode.write` (admin)
│   ├── core/
│   │   ├── doctors/
│   │   │   ├── create.ts                          # ALT — aceita payment_mode + params iniciais
│   │   │   ├── get.ts                             # ALT — retorna payment_mode + current params
│   │   │   ├── list.ts                            # ALT — retorna payment_mode + valor "current"
│   │   │   └── update-payment-mode.ts             # NOVO — escreve nova versão em history + UPDATE doctors
│   │   ├── payment-terms/                         # NOVO
│   │   │   ├── list-history.ts
│   │   │   ├── resolve-current.ts                 # SELECT from doctor_payment_terms_current view
│   │   │   └── seed-from-commission-history.ts    # usado APENAS no backfill da migration
│   │   ├── appointment-assistants/                # NOVO
│   │   │   ├── add.ts
│   │   │   ├── remove.ts                          # set removed_at
│   │   │   ├── list-by-appointment.ts
│   │   │   └── sum-by-doctor-period.ts            # usado pelo relatório por profissional
│   │   ├── appointments/
│   │   │   ├── create-manual.ts                   # ALT — INSERT em appointment_assistants junto (1 trx)
│   │   │   └── get.ts                             # ALT — embed assistants
│   │   └── reports/
│   │       ├── monthly.ts                         # ALT — SELECT FROM monthly_fixed_pay_lines
│   │       ├── by-professional.ts                 # ALT — branches por modalidade
│   │       └── operating-result.ts                # NOVO — fórmula completa (gross-rev − comm − fixed − liberal − tax − expenses)

supabase/migrations/
└── 0084_payment_modes_and_assistants.sql  # NOVO — todos os deltas

tests/
├── contract/
│   ├── api-medicos-payment-mode-rbac.spec.ts          # NOVO
│   ├── payment-terms-immutability.spec.ts             # NOVO (trigger SQL)
│   ├── payment-terms-tenant-isolation.spec.ts         # NOVO
│   ├── appointment-assistants-rbac.spec.ts            # NOVO
│   ├── appointment-assistants-tenant-isolation.spec.ts # NOVO
│   ├── appointment-assistants-immutability.spec.ts    # NOVO (trigger SQL — UPDATE só em removed_at)
│   ├── appointment-assistants-liberal-only.spec.ts    # NOVO (trigger valida modalidade)
│   └── doctors-payment-mode-backfill.spec.ts          # NOVO (verifica 1 row por doctor existente)
└── integration/
    ├── doctor-create-with-payment-mode.spec.ts        # NOVO (3 modalidades)
    ├── doctor-change-payment-mode-with-audit.spec.ts  # NOVO (mudança gera nova versão + audit)
    ├── appointment-create-with-assistants.spec.ts     # NOVO (multi-select, frozen value)
    ├── appointment-assistant-soft-remove.spec.ts      # NOVO (removed_at + relatório ignora)
    ├── monthly-report-with-fixed-pay-lines.spec.ts    # NOVO (view virtual)
    ├── professional-report-liberal-participations.spec.ts # NOVO
    └── operating-result-formula.spec.ts               # NOVO (regression em comissionados)
```

**Structure Decision**: reaproveita 100% a organização do monorepo (`src/app/(dashboard)`, `src/lib/core/<dominio>`, `src/app/api/<recurso>`, `supabase/migrations/`). Adiciona dois novos sub-domínios em `lib/core/` (`payment-terms`, `appointment-assistants`) e estende `doctors`, `appointments`, `reports`. Nenhuma fronteira arquitetural nova; sem dependência runtime nova; sem componente UI compartilhado novo (multi-select é primitivo já disponível em `shadcn/ui` Command/Popover).

## Complexity Tracking

> Esta seção fica vazia: a feature **não** introduz violação de constituição que mereça justificativa. Todas as decisões seguem padrões vigentes (append-only history `doctor_commission_history`/0005, append-only `appointment_materials`/0061, audit via `log_audit_event`, RLS por `tenant_id`, `requireRole`, ENUM nativo PG). Caso surja desvio durante a implementação, será adicionado aqui antes do merge.

| Violation  | Why Needed | Simpler Alternative Rejected Because |
| ---------- | ---------- | ------------------------------------ |
| _(nenhum)_ | —          | —                                    |

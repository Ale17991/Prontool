# Implementation Plan: Cadastro de Impostos e Imposto por Convênio

**Branch**: `011-cadastro-impostos` | **Date**: 2026-05-13 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-cadastro-impostos/spec.md`

## Summary

Quatro entregas independentes em volta de impostos:

1. **Cadastro de impostos da clínica** — CRUD por tenant (tabela nova `public.taxes`) em `Despesas → Impostos`, com nome, alíquota em basis points, descrição, categoria (Municipal/Estadual/Federal/Outro) e status ativo/inativo. Append-only (soft-delete + immutability trigger) + audit.
2. **Alíquota do convênio** — coluna nova `health_plans.tax_rate_bps INT NOT NULL DEFAULT 0`. UI controlada por checkbox "Convênio cobra imposto?" na página de edição do convênio; persistido por endpoint admin.
3. **Despesa vinculada a imposto cadastrado** — coluna opcional `expenses.tax_id UUID REFERENCES taxes(id)`; quando preenchida, força `category = 'impostos'` via CHECK constraint composto. UI no formulário de nova despesa.
4. **Impacto em relatórios e dashboard** — `buildFinancialReport` e `by-plan` deduzem `revenue × tax_rate_bps / 10000` por plano, separam `expensesByCategory.impostos` como linha própria e expõem `taxTotals = { fromPlans, fromExpenses, total }` no DTO. Dashboard exibe novo card "Impostos".

Stack já estabelecida: Next.js 14 (App Router), Supabase PostgreSQL com RLS multi-tenant, Zod, Tailwind, shadcn/ui. **Nenhuma nova dependência runtime**.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`, Pino 9. **Sem novas deps**.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0076_taxes_and_plan_tax_rate.sql` cria `public.taxes`, acrescenta `health_plans.tax_rate_bps`, acrescenta `expenses.tax_id`. Triggers de append-only e audit usam o padrão existente (`enforce_append_only`, `log_audit_event`, `session_uuid('app.actor_id')`).
**Testing**: Vitest (unit + integration). Para SQL, suite de integration roda contra stack local `supabase start`. Tests de contrato em `tests/contract/` cobrem RBAC e imutabilidade.
**Target Platform**: Vercel (Edge desabilitado nas rotas que usam DB; `export const runtime = 'nodejs'` é o padrão do projeto).
**Project Type**: web — App Router monolítico, sem split front/back.
**Performance Goals**: SC-004 — dashboard consolidado (card "Impostos") em ≤ 3 s para 12 meses de histórico. Listagem de impostos da clínica em ≤ 500 ms para N ≤ 50 (escopo realista por tenant).
**Constraints**:
- Append-only (Constitution I): triggers bloqueiam UPDATE/DELETE em `taxes`; só `is_active`/`deleted_at` mutáveis.
- Auditabilidade total (Constitution II): toda criação/alteração de imposto e mudança de `tax_rate_bps` gera linha em `audit_log` via `log_audit_event`.
- Isolamento multi-tenant (Constitution III): coluna `tenant_id` obrigatória + policies RLS + filtros explícitos quando service client é usado.
- Moeda em centavos / alíquota em basis points (Constitution domain): zero `float`. Conversão pt-BR (vírgula decimal) só na UI.
- RBAC server-side (Constitution V): `requireRole(['admin','financeiro'])` em todas as escritas; reads liberadas para todos os papéis autenticados (limitadas pelo RLS).
**Scale/Scope**: ~50 impostos cadastrados por tenant (limite alto), 100–500 convênios por tenant, 5000+ despesas/ano por tenant. Tudo já no envelope dos relatórios atuais.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Como esta feature cumpre |
|---|---|---|
| **I. Integridade Financeira Imutável (NON-NEGOTIABLE)** | ✅ Cumpre | `public.taxes`: trigger `enforce_taxes_mutation` impede alteração de `id`, `tenant_id`, `name`, `category`, `created_at`. Apenas `rate_bps`, `description`, `is_active`, `deleted_at` mutáveis (com auditoria). DELETE físico bloqueado por `enforce_append_only`. `health_plans.tax_rate_bps`: alteração permitida (já que `health_plans` é dimensão configurável, não fato financeiro), mas auditada. `expenses.tax_id`: imutável após criação (já incluído na trigger existente). |
| **II. Auditabilidade Total de Preços (NON-NEGOTIABLE)** | ✅ Cumpre | Triggers `audit_taxes_change` (AFTER INSERT/UPDATE) e `audit_health_plan_tax_rate_change` (AFTER UPDATE OF tax_rate_bps) chamam `log_audit_event` com tenant, ator, valor antigo/novo. `expenses.tax_id` é coberto pela auditoria de despesas (insert event já existente). |
| **III. Isolamento Multi-Tenant** | ✅ Cumpre | `taxes.tenant_id NOT NULL REFERENCES tenants(id)`. RLS habilitado: `SELECT` filtra por `jwt_tenant_id()`; `INSERT/UPDATE` adicionam `jwt_role() IN ('admin','financeiro')`. Coluna `tax_rate_bps` herda RLS de `health_plans` (já existente). Teste de cross-tenant leak em `tests/contract/taxes-rls.test.ts`. |
| **IV. Conformidade TUSS/ANS** | ➖ N/A | Feature não toca catálogo TUSS, códigos de procedimento, nem transmissão TISS. Imposto é dado interno da clínica. |
| **V. Segurança por Perfil de Acesso (RBAC)** | ✅ Cumpre | `requireRole(['admin','financeiro'])` nas rotas `POST /api/impostos`, `PATCH /api/impostos/[id]`, `PATCH /api/planos/[id]` (para `tax_rate_bps`). GET liberado a `admin/financeiro/recepcionista/profissional_saude` (leitura). Nova action `tax.write` adicionada ao `rbac.ts` matrix; `tax.read` herda de quem já tem `expense.read`. Testes de RBAC por endpoint em `tests/contract/api-taxes-rbac.test.ts`. |

**Gate de complexity tracking**: nenhum desvio justificável necessário — a feature usa exatamente os padrões já estabelecidos (RLS + append-only triggers + audit + `requireRole`).

## Project Structure

### Documentation (this feature)

```text
specs/011-cadastro-impostos/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisões resolvidas)
├── data-model.md        # Phase 1 — entidades, relacionamentos, constraints
├── quickstart.md        # Phase 1 — passo-a-passo dev (migration + smoke test)
├── contracts/
│   ├── api-impostos.md           # POST/GET/PATCH /api/impostos[/[id]]
│   ├── api-planos-tax-rate.md    # PATCH /api/planos/[id] (campo tax_rate_bps)
│   ├── api-despesas-tax-link.md  # extensão de POST /api/despesas
│   └── reports-dto.md            # mudanças no DTO de financial-report e by-plan
├── checklists/
│   └── requirements.md  # (já existente, da fase /speckit-specify)
└── tasks.md             # gerado por /speckit-tasks (não criado por /speckit-plan)
```

### Source Code (repository root)

A feature reaproveita 100% a estrutura monorepo existente; abaixo apenas os caminhos tocados.

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── analise/
│   │   │   ├── despesas/
│   │   │   │   ├── page.tsx                  # ALT — filtro de categoria + coluna "Imposto vinculado"
│   │   │   │   ├── new-expense-form.tsx      # ALT — checkbox "Vincular a imposto" + select
│   │   │   │   └── impostos/                 # NOVO — sub-seção "Impostos"
│   │   │   │       ├── page.tsx              # listagem + form (SSR)
│   │   │   │       ├── new-tax-form.tsx      # client component
│   │   │   │       ├── tax-row-actions.tsx   # editar / desativar / reativar
│   │   │   │       └── edit-tax-form.tsx     # client component (modal/popover)
│   │   │   └── relatorios/
│   │   │       ├── page.tsx                  # ALT — card "Impostos" + linha "Imposto do convênio" no by-plan
│   │   │       └── (export views se aplicável)
│   │   └── configuracoes/
│   │       └── convenios/
│   │           ├── new-plan-form.tsx         # ALT — checkbox + campo de alíquota
│   │           ├── [id]/
│   │           │   ├── page.tsx              # ALT — carrega tax_rate_bps + render do toggle
│   │           │   └── plan-tax-rate-form.tsx # NOVO — checkbox controlado + input %
│   ├── api/
│   │   ├── impostos/                         # NOVO
│   │   │   ├── route.ts                      # GET (list) + POST (create) — admin/financeiro
│   │   │   └── [id]/route.ts                 # PATCH (rate/description/active) — admin/financeiro
│   │   ├── planos/
│   │   │   └── [id]/route.ts                 # ALT — aceita { tax_rate_bps?: number }
│   │   └── despesas/
│   │       └── route.ts                      # ALT — aceita { tax_id?: string }, força categoria
├── lib/
│   ├── auth/
│   │   └── rbac.ts                           # ALT — adiciona 'tax.read' | 'tax.write'
│   ├── core/
│   │   ├── taxes/                            # NOVO
│   │   │   ├── create.ts
│   │   │   ├── list.ts
│   │   │   ├── update.ts                     # rate/description/is_active (não nome/categoria)
│   │   │   └── deactivate.ts                 # alias para update is_active=false (semantic)
│   │   ├── plans/
│   │   │   └── update-tax-rate.ts            # NOVO — admin only
│   │   ├── expenses/
│   │   │   ├── create.ts                     # ALT — aceita taxId, força category='impostos'
│   │   │   └── list.ts                       # ALT — projeta tax_id + tax{name} se houver join
│   │   └── reports/
│   │       ├── by-plan.ts                    # ALT — adiciona linha "tax_from_plan_cents"
│   │       └── financial-report.ts           # ALT — adiciona taxTotals + isola "impostos" em expensesByCategory
│   ├── validation/
│   │   └── rate-bps.ts                       # NOVO — helper percentual ↔ bps (vírgula, half-up)
│   └── observability/
│       └── errors.ts                         # reutilizado (ConflictError p/ duplicação de nome)

supabase/migrations/
└── 0076_taxes_and_plan_tax_rate.sql          # NOVO — cria taxes + tax_rate_bps + tax_id

tests/
├── contract/
│   ├── api-impostos-rbac.test.ts             # NOVO
│   ├── api-impostos-tenant-isolation.test.ts # NOVO
│   ├── api-planos-tax-rate-rbac.test.ts      # NOVO
│   ├── taxes-immutability.test.ts            # NOVO (testa trigger SQL)
│   └── expenses-tax-link-category.test.ts    # NOVO
├── integration/
│   ├── taxes-crud.test.ts                    # NOVO
│   ├── plan-tax-rate-flow.test.ts            # NOVO
│   ├── expenses-tax-linkage.test.ts          # NOVO
│   └── reports-with-taxes.test.ts            # NOVO (relatório por plano + dashboard)
└── unit/
    └── rate-bps.test.ts                      # NOVO (conversão pt-BR ↔ bps, half-up)
```

**Structure Decision**: reutiliza a organização do monorepo existente (`src/app/(dashboard)`, `src/lib/core/<dominio>`, `src/app/api/<recurso>`, `supabase/migrations/`). A feature **não** introduz nova fronteira arquitetural — apenas mais um sub-domínio (`taxes`) ao lado de `expenses`/`plans`. O caminho de UI das despesas vive em `analise/despesas` (rota já existente — não há `despesas` em outro lugar); a sub-rota `analise/despesas/impostos` é introduzida sob essa árvore por consistência de IA.

## Complexity Tracking

> Esta seção fica vazia: a feature **não** introduz nenhuma violação de constituição que mereça justificativa. Toda decisão segue padrões já vigentes (RLS multi-tenant, triggers append-only, `log_audit_event`, `requireRole`, `enforce_append_only`, `enforce_*_mutation`, `ConflictError`, locale pt-BR em UI). Caso surja desvio durante a implementação, será adicionado aqui antes do merge.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| _(nenhum)_ | — | — |

# Implementation Plan: Financeiro robusto — Fluxo de Caixa, Contas a Pagar/Receber, Repasse Médico

**Branch**: `023-financeiro-fluxo-repasse` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-financeiro-fluxo-repasse/spec.md`

## Summary

Construir 4-5 páginas operacionais (`/analise/contas-a-receber`, `/analise/contas-a-pagar`, `/analise/fluxo-caixa`, `/analise/repasse-medico/[mes]`, opcional `/analise/dashboard`) **sobre a infra financeira existente** (relatório consolidado, DRE mensal, comissões versionadas). 5 tabelas novas (`installment_payments`, `monthly_payouts`, `monthly_payouts_adjustments`, `monthly_payouts_reopens`, `tenant_cash_balance_adjustments`) e 6 colunas acrescentadas em `expenses` (`paid_at`, `paid_amount_cents`, `payment_method`, `recurring_starts_at`, `recurring_ends_at`, `superseded_by`). Tudo append-only, alinhado com Princípio I; auditoria total via `audit_log`; RLS por `tenant_id` + RLS adicional por `doctor.user_id` no repasse individual. **Não toca** funções existentes (`computeOperatingResult`, `buildFinancialReport`, `lib/core/commissions/`, `lib/core/payments/`) — apenas consome.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router + RSC + Server Actions), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix `Dialog`, `Sheet`, `Tabs`, `Table` já presentes), `date-fns` 4.1 + `date-fns-tz`, `lucide-react`, `recharts` (já em uso), Pino 9. **Sem novas deps de runtime**.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0096_financeiro_operacional.sql`. **Tabelas novas**: `installment_payments`, `monthly_payouts`, `monthly_payouts_adjustments`, `monthly_payouts_reopens`, `tenant_cash_balance_adjustments`. **Tabela alterada**: `expenses` (6 colunas novas, todas nullable — backwards compatible). **Funções DB novas**: `close_monthly_payout(p_tenant_id, p_month)` SECURITY DEFINER, `reopen_monthly_payout(p_tenant_id, p_month, p_reason)` SECURITY DEFINER, `record_installment_payment(...)` SECURITY DEFINER, `tenant_cash_balance_at(p_tenant_id, p_date)`. **Triggers**: anti-UPDATE/DELETE em tabelas append-only + auto-geração de `monthly_payouts_adjustments` quando atendimento de mês fechado é estornado.
**Testing**: Vitest. Esta feature: unit em `lib/core/cash-flow/`, `accounts-payable/`, `monthly-payouts/`, `installment-payments/`, `cash-balance/`; contract em `tests/contract/api-financeiro-*.spec.ts` (RBAC, tenant isolation, append-only triggers); integration de paridade com `computeOperatingResult` (SC-006); component smoke das páginas novas.
**Target Platform**: Web — Next.js 14 App Router. Browsers modernos.
**Project Type**: Web application (Next.js monorepo).
**Performance Goals**: SC-001 ≤3s carregar contas a receber; SC-002 ≤2s registrar pagamento; SC-004 ≤4s renderizar fluxo de caixa com 100 parcelas + 50 despesas em 3G; SC-007 zero UPDATEs em colunas de valor calculado.
**Constraints**: Append-only em 5 tabelas novas (triggers DB enforce); RBAC server-side em todas as rotas; LGPD para pacientes anonimizados; paridade absoluta com `computeOperatingResult`.
**Scale/Scope**: Clínica típica: ~100-500 parcelas/mês, ~30-80 despesas/mês, 3-15 médicos. Worst case projetado: 5000 parcelas + 500 despesas em 90 dias → agregação semanal automática (FR-026).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                              | Status  | Notas                                                                                                                                                                                                                               |
| -------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável** | ✅ PASS | 5 tabelas novas são append-only via trigger DB (FR-037, FR-043, FR-044). Reajustes versionam (Q1). Parcial via tabela append-only (Q2). Mês fechado imutável exceto janela 24h controlada (Q4). Saldo via ajustes append-only (Q5). |
| **II. Auditabilidade Total**           | ✅ PASS | FR-042 cobre todas. Cada SECURITY DEFINER chama `log_audit_event(...)`. Justificativas obrigatórias em reabertura (≥20 chars) e reversão (≥10 chars).                                                                               |
| **III. Isolamento Multi-Tenant**       | ✅ PASS | Todas as tabelas com `tenant_id` NOT NULL + RLS. RLS adicional em `monthly_payouts` filtra `doctor.user_id` para `profissional_saude`.                                                                                              |
| **IV. Conformidade TUSS/ANS**          | ✅ PASS | N/A direta — consome `appointments_effective` que já respeita TUSS.                                                                                                                                                                 |
| **V. RBAC**                            | ✅ PASS | FR-001/009/019/027 documentam papéis. Server-side via `requireRole(...)`. Defesa em camadas no repasse individual.                                                                                                                  |

**Domínio adicional**: LGPD (FR-045), UTC (lib `tenant-tz` já existe), cents (zero float), migrations reversíveis em dev.

**Verdict**: ✅ GATE PASSED. Zero violações. As 5 decisões de `/speckit.clarify` reforçam Princípio I em cada superfície de risco.

## Project Structure

### Documentation (this feature)

```text
specs/023-financeiro-fluxo-repasse/
├── plan.md
├── spec.md              # ✅ consolidada via /speckit.clarify (5 perguntas resolvidas)
├── research.md          # Phase 0 (criar)
├── data-model.md        # Phase 1 (criar)
├── quickstart.md        # Phase 1 (criar)
├── contracts/
│   ├── http-api.md      # Phase 1 — endpoints REST novos
│   └── sql-rpcs.md      # Phase 1 — funções DB SECURITY DEFINER
└── checklists/
    └── requirements.md  # ✅ Iteration 2 pós-clarify
```

### Source Code (repository root)

```text
src/
├── app/(dashboard)/analise/
│   ├── contas-a-receber/{page.tsx, installments-table.tsx, register-payment-modal.tsx, mark-bad-debt-modal.tsx}
│   ├── contas-a-pagar/{page.tsx, expenses-table.tsx, mark-paid-modal.tsx, version-expense-modal.tsx}
│   ├── fluxo-caixa/{page.tsx, cash-flow-chart.tsx, events-table.tsx, scale-toggle.tsx}
│   ├── repasse-medico/{page.tsx (redirect mês atual), [mes]/{page.tsx, payouts-table.tsx, individual-payout.tsx, close-month-modal.tsx, reopen-month-modal.tsx, mark-paid-modal.tsx}}
│   └── dashboard/  # opcional (US5)
├── app/api/financeiro/
│   ├── contas-a-receber/{route.ts (GET), [installmentId]/{payment, bad-debt, reverse-payment}/route.ts}
│   ├── contas-a-pagar/{route.ts (GET), [expenseId]/{pay, version, end-recurring}/route.ts}
│   ├── fluxo-caixa/route.ts
│   └── repasse-medico/[mes]/{route.ts (GET), close, reopen, payouts/[payoutId]/mark-paid}/route.ts
├── app/api/configuracoes/cash-balance/route.ts  # GET histórico + POST ajuste
└── lib/core/
    ├── cash-flow/           # NOVO
    ├── accounts-receivable/ # NOVO
    ├── accounts-payable/    # NOVO (inclui projeção recorrente + versionamento)
    ├── installment-payments/ # NOVO
    ├── monthly-payouts/      # NOVO (compute, close, reopen, mark-paid, adjustments)
    └── cash-balance/         # NOVO

supabase/migrations/
└── 0096_financeiro_operacional.sql  # 5 tabelas + 6 colunas + 4 RPCs + triggers + RLS

tests/
├── unit/{cash-flow-assemble, cash-flow-aggregate, recurring-projection, monthly-payouts-compute, installment-payments-sum}.spec.ts
├── contract/{api-financeiro-rbac, api-financeiro-tenant-isolation, api-monthly-payouts-append-only, api-cash-balance-append-only, api-installment-payments-append-only}.spec.ts
└── integration/{monthly-payout-close-reopen-flow, recurring-expense-reajuste-flow}.spec.ts
```

**Structure Decision**: convenção Next.js App Router já estabelecida no projeto. Páginas sob `app/(dashboard)/analise/<feature>/` (consistente com `relatorios/`, `comissoes/`, `despesas/`, `auditoria/`). Lógica pura em `lib/core/<dominio>/`. Rotas API sob `app/api/financeiro/<feature>/`. Componentes específicos ficam junto da page que os usa (padrão de `relatorios/financial-revenue-chart.tsx`).

## Phase 0 — Outline & Research (planejado)

Itens que `research.md` resolverá:

1. **`paid_amount_cents` derivado de `installment_payments`** — trigger cacheado vs view materializada vs JOIN/SUM on-the-fly.
2. **Projeção de despesas recorrentes** — server-side (`generate_series`) vs client TypeScript.
3. **Agregação >500 eventos no fluxo** — server (`date_trunc`) vs client groupBy.
4. **Trigger anti-UPDATE em tabelas append-only** — reuso de pattern existente em migrations.
5. **`reopen_monthly_payout` + snapshot_before** — pattern de serializar JSONB.
6. **Indexes** — composites para queries mais comuns.
7. **Estornos pós-fechamento** — trigger em `appointment_reversals` que gera `monthly_payouts_adjustments`.
8. **Paridade com `computeOperatingResult`** — strategy de teste de igualdade campo-a-campo.

## Phase 1 — Design & Contracts (planejado)

1. **data-model.md**: schema completo das 5 tabelas (colunas+tipos+constraints+indexes+RLS+triggers), 6 colunas em `expenses`, regras de transição.
2. **contracts/http-api.md**: ~15 endpoints REST, payloads Zod, status codes, mapeamento FR→endpoint.
3. **contracts/sql-rpcs.md**: 4 funções SECURITY DEFINER com assinaturas, side-effects, grants, contratos de retorno.
4. **quickstart.md**: 8-10 cenários smoke-test manual.
5. **Agent context update**: `update-agent-context.ps1 -AgentType claude`.

## Complexity Tracking

Sem violações da constituição; Complexity Tracking vazio.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |

## Constitution Check — Re-evaluation pós-Phase 1 (2026-05-20)

| Princípio                              | Status pós-design | Notas adicionais                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável** | ✅ PASS           | `data-model.md` documenta 5 tabelas novas, todas com trigger `enforce_append_only_columns`. Único cache que sofre UPDATE é `payment_installments.paid_amount_cents` — derivado, justificado em R1, semanticamente correto (espelha pagamentos append-only). `monthly_payouts` tem whitelist explícita (`closed_at, closed_by, paid_at, paid_amount_cents, payment_method, payment_note`). |
| **II. Auditabilidade Total**           | ✅ PASS           | Cada RPC SECURITY DEFINER chama `log_audit_event(...)` antes do RETURN. Justificativas obrigatórias em reabertura (≥20 chars) e reversão (≥10 chars). `monthly_payouts_reopens` preserva snapshot JSONB do estado antes da reabertura — forense avançado.                                                                                                                                 |
| **III. Isolamento Multi-Tenant**       | ✅ PASS           | `data-model.md` §10 lista checklist completa: RLS em todas as 5 tabelas; RLS dupla em `monthly_payouts` (tenant + doctor.user_id) para profissional_saude; RPCs validam tenant + role internamente.                                                                                                                                                                                       |
| **IV. Conformidade TUSS/ANS**          | ✅ PASS           | N/A — feature consome `appointments_effective` (que já respeita TUSS) sem tocar catálogo.                                                                                                                                                                                                                                                                                                 |
| **V. RBAC**                            | ✅ PASS           | Cada endpoint em `contracts/http-api.md` documenta `Auth:` com papéis permitidos. Server-side via `requireRole(...)`. Lint check existente (`scripts/check-require-role.mjs`) garante 100% de cobertura.                                                                                                                                                                                  |
| **LGPD**                               | ✅ PASS           | FR-045 documentado em http-api; payloads de audit usam IDs (não nomes). Anonimização do paciente preservada em contas a receber.                                                                                                                                                                                                                                                          |

**Verdict pós-design**: ✅ GATE PASSED novamente. Design respeita constitutição em todas as 6 superfícies. Phase 1 completa. Pronta para `/speckit.tasks`.

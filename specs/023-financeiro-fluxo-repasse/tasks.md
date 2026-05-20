# Tasks: 023 — Financeiro robusto (Fluxo de Caixa, Contas a Pagar/Receber, Repasse Médico)

**Input**: Design documents from `/specs/023-financeiro-fluxo-repasse/`
**Prerequisites**: plan.md ✅, spec.md ✅ (5 clarifications consolidadas), research.md ✅, data-model.md ✅, contracts/{http-api.md, sql-rpcs.md} ✅, quickstart.md ✅

**Tests**: Incluídos por SC-009 da spec (bateria de regressão 100% antes do merge). Cobertura: contract (RBAC, tenant isolation, append-only triggers), unit (projeção recorrente, agregação cash flow, soma de installment_payments, paridade compute), integration (close→reopen flow, reajuste recorrente flow), component smoke (cada página nova).

**Organization**: Tarefas agrupadas por user story. **MVP = US1 (Contas a Receber) + US2 (Contas a Pagar)** — ambas P1, mais imediatamente úteis no dia-a-dia da clínica.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência entre tasks em aberto)
- **[Story]**: Qual user story pertence (`US1`-`US5`)
- Caminhos absolutos a partir da raiz do repo

## Path Conventions

- Páginas Next.js: `src/app/(dashboard)/analise/<feature>/...`
- APIs: `src/app/api/financeiro/<feature>/...` ou `src/app/api/configuracoes/cash-balance/`
- Lógica pura: `src/lib/core/<dominio>/`
- Migration: `supabase/migrations/0096_financeiro_operacional.sql`
- Testes: `tests/unit/`, `tests/contract/`, `tests/integration/`, `tests/components/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Estrutura de diretórios e validação de pré-requisitos.

- [ ] T001 [P] Criar diretórios: `src/app/(dashboard)/analise/contas-a-receber/`, `contas-a-pagar/`, `fluxo-caixa/`, `repasse-medico/`, `repasse-medico/[mes]/`, `dashboard/`; `src/app/api/financeiro/contas-a-receber/`, `contas-a-pagar/`, `fluxo-caixa/`, `repasse-medico/`; `src/app/api/configuracoes/cash-balance/`; `src/lib/core/cash-flow/`, `accounts-receivable/`, `accounts-payable/`, `installment-payments/`, `monthly-payouts/`, `cash-balance/`; `tests/components/financeiro/`
- [ ] T002 [P] Confirmar `@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `recharts`, `date-fns`, `date-fns-tz` em `package.json` (nenhuma nova dep esperada)
- [ ] T003 [P] Verificar que `lib/utils/tenant-tz.ts` exporta `getTenantTimezone`, `ymdStartOfDayUtc`, `dateToTenantYmd` — usados pelo fluxo de caixa e repasse

**Checkpoint**: Estrutura de pastas pronta; dependências confirmadas.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration única `0096`, helpers SQL, RLS, RPCs, types gerados. **⚠️ CRITICAL: nenhuma US pode começar até esta fase estar completa.**

### Migration SQL

- [ ] T004 Escrever migration `supabase/migrations/0096_financeiro_operacional.sql` parte 1 (helpers SQL genéricos): `enforce_append_only_columns()` (trigger function com whitelist via TG_ARGV), `raise_no_delete()` para tabelas estritas
- [ ] T005 [P] Migration parte 2 (ALTER em `expenses`): acrescentar `paid_at`, `paid_amount_cents`, `payment_method`, `recurring_starts_at`, `recurring_ends_at`, `superseded_by` + backfill `recurring_starts_at = competence_date` em recorrentes existentes + index parciais (idx_expenses_pending_by_tenant, idx_expenses_recurring_active) + CHECK constraint de tenant em superseded_by
- [ ] T006 [P] Migration parte 3 (CREATE TABLE `installment_payments`): schema + RLS + trigger `enforce_append_only_columns` (allowed: vazio) + trigger `refresh_installment_paid_cache` AFTER INSERT
- [ ] T007 [P] Migration parte 4 (CREATE TABLE `monthly_payouts`): schema com `total_due_cents` GENERATED STORED + UNIQUE(tenant, doctor, month) + 3 indexes + RLS dupla (admin/financeiro OU profissional_saude com doctor.user_id match) + trigger anti-UPDATE com whitelist (`closed_at`, `closed_by`, `paid_at`, `paid_amount_cents`, `payment_method`, `payment_note`, `updated_at`) + trigger no-DELETE
- [ ] T008 [P] Migration parte 5 (CREATE TABLE `monthly_payouts_adjustments`): schema append-only + RLS + index (tenant, applied_month, doctor)
- [ ] T009 [P] Migration parte 6 (CREATE TABLE `monthly_payouts_reopens`): schema com `snapshot_before JSONB NOT NULL` + RLS restrito a admin + index (tenant, month)
- [ ] T010 [P] Migration parte 7 (CREATE TABLE `tenant_cash_balance_adjustments`): schema com `amount_cents` (com sinal) + RLS (admin/financeiro select; admin insert) + index (tenant, effective_from desc)
- [ ] T011 Migration parte 8 (trigger function `refresh_installment_paid_cache`): SELECT SUM/MAX → UPDATE em payment_installments com status derivado (pendente/parcial/pago/atrasado). **Depende de T006**
- [ ] T012 Migration parte 9 (trigger function `generate_payout_adjustment_if_closed`): AFTER INSERT em appointment_reversals → calcula original_month → verifica se mês fechado → INSERT em monthly_payouts_adjustments com delta negativo. **Depende de T007 e T008**
- [ ] T013 Migration parte 10 (function `tenant_cash_balance_at(p_tenant, p_date)`): SELECT SUM amount_cents WHERE effective_from <= p_date. **Depende de T010**
- [ ] T014 Migration parte 11 (function `close_monthly_payout(p_tenant_id, p_month)`): SECURITY DEFINER, validações, INSERT em monthly_payouts por médico ativo (idempotente com ON CONFLICT DO NOTHING), UPDATE closed_at/closed_by, audit log. **Depende de T007**
- [ ] T015 Migration parte 12 (function `reopen_monthly_payout(p_tenant_id, p_month, p_reason)`): SECURITY DEFINER, validações FR-032a (24h + sem pagos + reason ≥20 chars), captura snapshot JSONB via `jsonb_agg(row_to_json(p.*))`, INSERT em monthly_payouts_reopens, UPDATE zerando closed_at/closed_by, audit log. **Depende de T007, T009**

### Apply + Types + Roles

- [ ] T016 Rodar `pnpm supabase:reset` para aplicar migration 0096 limpa; verificar nenhum erro. **Depende de T004-T015**
- [ ] T017 Rodar `pnpm supabase:gen-types` para regenerar `src/lib/db/generated/types.ts` com as novas tabelas/colunas. **Depende de T016**
- [ ] T018 [P] Atualizar matriz RBAC em `src/lib/auth/rbac.ts` se houver ações novas (provavelmente não — todas as ações novas usam papéis existentes). Verificar e documentar se nada muda

### Tests Foundationais

- [ ] T019 [P] Contract test `tests/contract/api-financeiro-append-only-triggers.spec.ts`: tentar UPDATE direto em colunas calculadas de monthly_payouts e DELETE em installment_payments via service role — ambas devem RAISE EXCEPTION
- [ ] T020 [P] Contract test `tests/contract/api-financeiro-tenant-isolation.spec.ts`: criar dados em tenant A; tentar SELECT/INSERT a partir de tenant B; verificar RLS bloqueia 100%
- [ ] T021 [P] Unit test `tests/unit/refresh-installment-paid-cache.spec.ts`: inserir 3 pagamentos parciais (R$ 20+20+20 numa parcela de R$ 60); verificar cache em payment_installments.paid_amount_cents = 60, status = 'pago'

**Checkpoint**: Migration aplicada, types regenerados, triggers funcionando. Todas as US podem começar em paralelo.

---

## Phase 3: User Story 1 — Contas a Receber (Priority: P1) 🎯 MVP

**Goal**: Recepção/Financeiro vê parcelas a receber consolidadas. Pode registrar pagamentos parciais ou totais sem sair da página. Marcar inadimplência ou reverter pagamento (RBAC).

**Independent Test**: Cenário 1 do `quickstart.md` — 30+ parcelas em estados variados, lista consolidada, registrar pagamento parcial, badge "Atraso crítico", filtros.

### Core lib

- [ ] T022 [P] [US1] Tipos em `src/lib/core/installment-payments/types.ts`: `InstallmentPaymentDTO`, `RecordPaymentInput`, `ReversePaymentInput`
- [ ] T023 [P] [US1] Tipos em `src/lib/core/accounts-receivable/types.ts`: `ReceivableRow` (com paciente normalizado, dias em atraso, status enriquecido), `ReceivableFilters`, `ReceivableSummary`
- [ ] T024 [P] [US1] `src/lib/core/installment-payments/record.ts` — função `recordInstallmentPayment(supabase, args)` com validação Zod (amount > 0, ≤ pending), INSERT em installment_payments. **Depende de T017, T022**
- [ ] T025 [P] [US1] `src/lib/core/installment-payments/reverse.ts` — função `reverseInstallmentPayment` insere linha de estorno com amount negativo + note obrigatória. **Depende de T017, T022**
- [ ] T026 [P] [US1] `src/lib/core/installment-payments/list-by-installment.ts` — `listPaymentsForInstallment(supabase, installmentId)` retorna histórico ordenado por paid_at desc. **Depende de T017, T022**
- [ ] T027 [US1] `src/lib/core/accounts-receivable/list.ts` — `listReceivables(supabase, filters)` JOIN payment_installments com patients + plans, aplica filtros, calcula `days_overdue` e `status` enriquecido, anonimização LGPD (FR-045). **Depende de T017, T023**
- [ ] T028 [P] [US1] `src/lib/core/installment-payments/index.ts` + `src/lib/core/accounts-receivable/index.ts` barrels

### API Routes

- [ ] T029 [US1] `src/app/api/financeiro/contas-a-receber/route.ts` GET: `requireRole(['admin', 'financeiro', 'recepcionista'])`, valida query Zod, chama `listReceivables`. **Depende de T027**
- [ ] T030 [US1] `src/app/api/financeiro/contas-a-receber/[installmentId]/payment/route.ts` POST: `requireRole(['admin', 'financeiro', 'recepcionista'])`, body Zod, chama `recordInstallmentPayment`, log_audit_event. **Depende de T024**
- [ ] T031 [US1] `src/app/api/financeiro/contas-a-receber/[installmentId]/bad-debt/route.ts` POST: `requireRole(['admin', 'financeiro'])`, atualiza status='inadimplencia', audit. **Depende de T017**
- [ ] T032 [US1] `src/app/api/financeiro/contas-a-receber/[installmentId]/reverse-payment/route.ts` POST: `requireRole(['admin'])`, body com payment_id + reason ≥10 chars, chama `reverseInstallmentPayment`. **Depende de T025**

### UI

- [ ] T033 [P] [US1] `src/app/(dashboard)/analise/contas-a-receber/page.tsx` — Server Component, parseia searchParams, chama `listReceivables`, renderiza header + filtros + tabela. **Depende de T027**
- [ ] T034 [P] [US1] `src/app/(dashboard)/analise/contas-a-receber/installments-table.tsx` — Client Component, recebe linhas, renderiza Table shadcn + badges de status + botões de ação (gates de RBAC)
- [ ] T035 [P] [US1] `src/app/(dashboard)/analise/contas-a-receber/register-payment-modal.tsx` — Client Component Dialog, form com Zod, POST para /payment, `router.refresh()` ao sucesso
- [ ] T036 [P] [US1] `src/app/(dashboard)/analise/contas-a-receber/mark-bad-debt-modal.tsx` — Dialog, reason opcional, POST para /bad-debt
- [ ] T037 [P] [US1] `src/app/(dashboard)/analise/contas-a-receber/_components/payment-history-list.tsx` — Lista parciais já registrados para uma parcela (mostrada no register-payment-modal)

### Tests US1

- [ ] T038 [P] [US1] Contract test `tests/contract/api-financeiro-contas-a-receber-rbac.spec.ts` — todos os 4 papéis × 4 endpoints. Recepcionista sem `reverse-payment` (403)
- [ ] T039 [P] [US1] Unit test `tests/unit/accounts-receivable-list.spec.ts` — filtros, status enriquecido, anonimização LGPD
- [ ] T040 [P] [US1] Integration test `tests/integration/installment-multiple-partial-payments.spec.ts` — 3 pagamentos parciais somam corretamente; status muda parcial→pago; trigger cache funciona
- [ ] T041 [P] [US1] Component smoke `tests/components/financeiro/register-payment-modal.test.tsx` — Esc fecha, validação amount obrigatório, chama onSuccess

**Checkpoint**: US1 fully functional. Cenário 1 do quickstart passa. Já é shippable como MVP parcial.

---

## Phase 4: User Story 2 — Contas a Pagar (Priority: P1) 🎯 MVP

**Goal**: Admin/Financeiro vê despesas a pagar agrupadas por mês. Projeções recorrentes 90 dias. Marcar pago, encerrar recorrente, reajustar com versionamento.

**Independent Test**: Cenário 2 do `quickstart.md` — 8 despesas + 2 recorrentes, projeções aparecem, pagar 1, reajustar valor preserva histórico (Princípio I).

### Core lib

- [ ] T042 [P] [US2] Tipos em `src/lib/core/accounts-payable/types.ts`: `PayableRow` (com is_projection flag, parent_id se projeção, status enriquecido), `PayableFilters`, `RecurringProjectionInput`
- [ ] T043 [P] [US2] `src/lib/core/accounts-payable/project-recurring.ts` — função pura `projectRecurringExpenses(expenses, from, to)` respeitando `recurring_starts_at`/`recurring_ends_at`/`superseded_by`. **Decisão R2: client-side TS, sem DB**
- [ ] T044 [US2] `src/lib/core/accounts-payable/list-with-projections.ts` — busca despesas + chama `projectRecurringExpenses` + filtra/ordena/agrupa por mês. **Depende de T042, T043**
- [ ] T045 [P] [US2] `src/lib/core/accounts-payable/version-expense.ts` — função `versionExpense(supabase, args)` que (a) UPDATE `recurring_ends_at` na antiga, (b) INSERT nova com `recurring_starts_at`, (c) UPDATE `superseded_by` da antiga apontando para nova. Tudo em transação. Audit log. **Depende de T017**
- [ ] T046 [P] [US2] `src/lib/core/accounts-payable/mark-paid.ts` — UPDATE expenses paid_at/paid_amount/payment_method (whitelist). Validação `paid_at IS NULL`. Audit. **Depende de T017**
- [ ] T047 [P] [US2] `src/lib/core/accounts-payable/end-recurring.ts` — UPDATE só `recurring_ends_at` sem versão; audit
- [ ] T048 [P] [US2] `src/lib/core/accounts-payable/index.ts` barrel

### API Routes

- [ ] T049 [US2] `src/app/api/financeiro/contas-a-pagar/route.ts` GET: requireRole(admin/financeiro), Zod query, chama listWithProjections. **Depende de T044**
- [ ] T050 [US2] `src/app/api/financeiro/contas-a-pagar/[expenseId]/pay/route.ts` POST. **Depende de T046**
- [ ] T051 [US2] `src/app/api/financeiro/contas-a-pagar/[expenseId]/version/route.ts` POST. **Depende de T045**
- [ ] T052 [US2] `src/app/api/financeiro/contas-a-pagar/[expenseId]/end-recurring/route.ts` POST. **Depende de T047**

### UI

- [ ] T053 [P] [US2] `src/app/(dashboard)/analise/contas-a-pagar/page.tsx` — SSR
- [ ] T054 [P] [US2] `src/app/(dashboard)/analise/contas-a-pagar/expenses-table.tsx` — agrupa por mês, mostra subtotal por grupo, distingue projeções recorrentes (badge "Projeção"), botões de ação
- [ ] T055 [P] [US2] `src/app/(dashboard)/analise/contas-a-pagar/mark-paid-modal.tsx` — Dialog
- [ ] T056 [P] [US2] `src/app/(dashboard)/analise/contas-a-pagar/version-expense-modal.tsx` — Dialog: effective_from + new_amount + reason; mostra preview "Esta despesa será encerrada em X e nova começará em Y com novo valor Z"
- [ ] T057 [P] [US2] `src/app/(dashboard)/analise/contas-a-pagar/_components/recurring-projection-row.tsx` — linha estilizada para projeções (read-only, com link para despesa-mãe)

### Tests US2

- [ ] T058 [P] [US2] Contract test `tests/contract/api-financeiro-contas-a-pagar-rbac.spec.ts` — admin/financeiro × 4 endpoints; profissional_saude/recepcionista 403
- [ ] T059 [P] [US2] Unit test `tests/unit/recurring-projection.spec.ts` — respeito a starts_at/ends_at/superseded_by; janelas de 30/60/90 dias; despesa com período encerrado some
- [ ] T060 [P] [US2] Integration test `tests/integration/recurring-expense-versioning-flow.spec.ts` — cria recorrente, reajusta, verifica linhagem `superseded_by`, audit, projeções refletem ambos valores ao longo do tempo
- [ ] T061 [P] [US2] Append-only contract `tests/contract/api-expenses-paid-update.spec.ts` — tentar UPDATE em `amount_cents` ou `competence_date` retorna erro (trigger DB)

**Checkpoint**: US1 + US2 funcionais. **MVP entregavel**. Cenários 1 e 2 do quickstart passam. Já é deploy-ready.

---

## Phase 5: User Story 3 — Fluxo de Caixa (Priority: P2)

**Goal**: Admin/Financeiro vê linha do tempo de entradas/saídas com saldo acumulado, projeção 90 dias, troca de escala daily/weekly/monthly.

**Independent Test**: Cenário 3 do `quickstart.md` — 10 parcelas + 5 despesas + 2 recorrentes, gráfico mostra curva, troca de escala funciona, ponto negativo destacado.

### Core lib

- [ ] T062 [P] [US3] Tipos em `src/lib/core/cash-flow/types.ts`: `CashFlowEvent` (kind: entry|exit, source: installment|expense, source_id), `CashFlowBucket`, `CashFlowScale`, `CashFlowResult`
- [ ] T063 [P] [US3] Tipos em `src/lib/core/cash-balance/types.ts`: `CashBalanceAdjustmentRow`, `AddAdjustmentInput`
- [ ] T064 [P] [US3] `src/lib/core/cash-balance/adjustments.ts` — `listAdjustments` + `addAdjustment` (apenas admin via RBAC server-side; persiste em tenant_cash_balance_adjustments). **Depende de T017**
- [ ] T065 [P] [US3] `src/lib/core/cash-balance/compute-at.ts` — `tenantCashBalanceAt(supabase, tenantId, date)` chama RPC `tenant_cash_balance_at`. **Depende de T013**
- [ ] T066 [US3] `src/lib/core/cash-flow/assemble.ts` — `assembleCashFlow(supabase, args)` combina installments pagas/pendentes + expenses pagas/pendentes + projeções recorrentes (reusa `projectRecurringExpenses` de T043), retorna array de eventos. **Depende de T043, T064, T065**
- [ ] T067 [P] [US3] `src/lib/core/cash-flow/aggregate.ts` — função pura `aggregateByScale(events, scale, startingBalance)` retorna buckets com delta + balance_after. Algoritmo determinístico, ordenado cronologicamente
- [ ] T068 [P] [US3] `src/lib/core/cash-flow/index.ts` + `src/lib/core/cash-balance/index.ts` barrels

### API Routes

- [ ] T069 [US3] `src/app/api/financeiro/fluxo-caixa/route.ts` GET: requireRole(admin/financeiro), Zod query (from, to, scale), chama assembleCashFlow + aggregateByScale. **Depende de T066, T067**
- [ ] T070 [US3] `src/app/api/configuracoes/cash-balance/route.ts` GET + POST: GET histórico (admin/financeiro), POST novo ajuste (admin only). **Depende de T064**

### UI

- [ ] T071 [P] [US3] `src/app/(dashboard)/analise/fluxo-caixa/page.tsx` — SSR
- [ ] T072 [P] [US3] `src/app/(dashboard)/analise/fluxo-caixa/cash-flow-chart.tsx` — recharts LineChart com curva de saldo, destaque vermelho onde balance <0, eixos eixo X data + eixo Y cents formatados
- [ ] T073 [P] [US3] `src/app/(dashboard)/analise/fluxo-caixa/events-table.tsx` — tabela de eventos individuais, agrupada por bucket da escala atual
- [ ] T074 [P] [US3] `src/app/(dashboard)/analise/fluxo-caixa/scale-toggle.tsx` — toggle entre daily/weekly/monthly; re-agrega no client
- [ ] T075 [P] [US3] Modificar `src/app/(dashboard)/configuracoes/clinica/page.tsx` para incluir card "Saldo de caixa" com lista de ajustes + botão modal "Adicionar ajuste"
- [ ] T076 [P] [US3] `src/app/(dashboard)/configuracoes/clinica/cash-balance-card.tsx` — Client Component que mostra saldo atual + histórico + dialog para novo ajuste
- [ ] T077 [P] [US3] `src/app/(dashboard)/configuracoes/clinica/add-balance-adjustment-modal.tsx` — Dialog

### Tests US3

- [ ] T078 [P] [US3] Contract test `tests/contract/api-cash-balance-rbac.spec.ts` — admin POST/GET; financeiro GET only; outros 403. Append-only via trigger DB.
- [ ] T079 [P] [US3] Unit test `tests/unit/cash-flow-aggregate.spec.ts` — daily/weekly/monthly buckets corretos, saldo acumulado bate, ponto negativo identificado
- [ ] T080 [P] [US3] Unit test `tests/unit/cash-flow-assemble.spec.ts` — combina installments + expenses + projeções; respeita anonimização (eventos de paciente anonimizado mantêm valor mas descrição neutra)
- [ ] T081 [P] [US3] Unit test `tests/unit/cash-balance-compute-at.spec.ts` — saldo em data X = SUM até effective_from ≤ X

**Checkpoint**: US1 + US2 + US3 funcionais. Cenários 1-4 do quickstart passam.

---

## Phase 6: User Story 4 — Repasse Médico (Priority: P2)

**Goal**: Admin fecha repasse mensal por médico em snapshot append-only. Pode reabrir nas primeiras 24h se nenhum pago. Médico vê só o próprio.

**Independent Test**: Cenários 5, 6, 7, 8 do `quickstart.md` — fecha mês, estorno gera ajuste automático, reabertura respeita FR-032a, profissional_saude vê só si.

### Core lib

- [ ] T082 [P] [US4] Tipos em `src/lib/core/monthly-payouts/types.ts`: `MonthlyPayoutLine` (com lifecycle status: open|closed), `MonthlyPayoutSnapshot`, `MonthlyPayoutAdjustment`, `CloseMonthInput`, `ReopenMonthInput`
- [ ] T083 [P] [US4] `src/lib/core/monthly-payouts/compute.ts` — função `computeLiveMonthlyPayouts(supabase, tenantId, month)` para mês aberto: queries equivalentes à `computeOperatingResult` mas decompostas por doctor_id. Retorna array `MonthlyPayoutLine`. **Depende de T017**
- [ ] T084 [US4] `src/lib/core/monthly-payouts/close.ts` — chama RPC `close_monthly_payout(p_tenant, p_month)` via supabase.rpc. **Depende de T014**
- [ ] T085 [US4] `src/lib/core/monthly-payouts/reopen.ts` — chama RPC `reopen_monthly_payout(p_tenant, p_month, p_reason)`. **Depende de T015**
- [ ] T086 [P] [US4] `src/lib/core/monthly-payouts/mark-paid.ts` — UPDATE monthly_payouts colunas de pagamento (whitelist via trigger). Audit. **Depende de T007**
- [ ] T087 [P] [US4] `src/lib/core/monthly-payouts/adjustments.ts` — `listAdjustmentsForMonth(supabase, tenantId, month)` lê monthly_payouts_adjustments aplicados ao mês
- [ ] T088 [P] [US4] `src/lib/core/monthly-payouts/individual-detail.ts` — para profissional_saude: lista atendimentos do mês com valor bruto + percentual de comissão + valor líquido (FR-036)
- [ ] T089 [P] [US4] `src/lib/core/monthly-payouts/index.ts` barrel

### API Routes

- [ ] T090 [US4] `src/app/api/financeiro/repasse-medico/[mes]/route.ts` GET: requireRole(admin/financeiro/profissional_saude); admin/financeiro recebe lista completa; profissional_saude filtrado server-side por doctor.user_id + appointments_detail. **Depende de T083, T088**
- [ ] T091 [US4] `src/app/api/financeiro/repasse-medico/[mes]/close/route.ts` POST: requireRole(admin). **Depende de T084**
- [ ] T092 [US4] `src/app/api/financeiro/repasse-medico/[mes]/reopen/route.ts` POST: requireRole(admin), body Zod com reason ≥20 chars. **Depende de T085**
- [ ] T093 [US4] `src/app/api/financeiro/repasse-medico/[mes]/payouts/[payoutId]/mark-paid/route.ts` POST: requireRole(admin/financeiro). **Depende de T086**

### UI

- [ ] T094 [P] [US4] `src/app/(dashboard)/analise/repasse-medico/page.tsx` — redireciona para `/repasse-medico/{mes-atual}`
- [ ] T095 [US4] `src/app/(dashboard)/analise/repasse-medico/[mes]/page.tsx` — SSR; admin/financeiro chama PayoutsTable; profissional_saude chama IndividualPayout. **Depende de T090**
- [ ] T096 [P] [US4] `src/app/(dashboard)/analise/repasse-medico/[mes]/payouts-table.tsx` — Client Component, lista médicos com 4 componentes financeiros + total + status + ações
- [ ] T097 [P] [US4] `src/app/(dashboard)/analise/repasse-medico/[mes]/individual-payout.tsx` — view do profissional_saude: card resumo + tabela de atendimentos com valor/percentual/comissão
- [ ] T098 [P] [US4] `src/app/(dashboard)/analise/repasse-medico/[mes]/close-month-modal.tsx` — confirmação dupla
- [ ] T099 [P] [US4] `src/app/(dashboard)/analise/repasse-medico/[mes]/reopen-month-modal.tsx` — Dialog com textarea de motivo ≥20 chars, mostra precondições antes (24h restantes + zero pagos)
- [ ] T100 [P] [US4] `src/app/(dashboard)/analise/repasse-medico/[mes]/mark-paid-modal.tsx` — Dialog: data + valor + método + nota

### Tests US4

- [ ] T101 [P] [US4] Integration test `tests/integration/monthly-payout-paridade.spec.ts` — **CRITICAL SC-006**: fixture com 5 médicos × 30 atendimentos; rodar `computeOperatingResult(month)`; rodar `close_monthly_payout(month)`; assertar SUM(monthly_payouts.commission_cents) == lines.commissionsCents (mesma lógica para fixed/liberal/gross)
- [ ] T102 [P] [US4] Integration test `tests/integration/monthly-payout-close-reopen-flow.spec.ts` — fecha mês, tenta reabrir após 25h (falha), tenta reabrir com 1 pago (falha), reabre com sucesso, snapshot_before populado
- [ ] T103 [P] [US4] Integration test `tests/integration/monthly-payout-adjustment-auto.spec.ts` — fecha mês X, estorna atendimento do mês X, verifica linha automática em monthly_payouts_adjustments com applied_month = X+1
- [ ] T104 [P] [US4] Contract test `tests/contract/api-repasse-medico-rls-doctor.spec.ts` — profissional_saude vinculado a doctor A; GET /repasse-medico só retorna linha de A, não de B/C
- [ ] T105 [P] [US4] Contract test `tests/contract/api-monthly-payouts-append-only.spec.ts` — UPDATE em commission_cents ou gross_revenue_cents direto falha (trigger); UPDATE em paid_at funciona

**Checkpoint**: US1 + US2 + US3 + US4 funcionais. Paridade SC-006 verificada. Cenários 1-9 do quickstart passam.

---

## Phase 7: User Story 5 — Dashboard Executivo (Priority: P3, OPCIONAL)

**Goal**: KPIs visuais no topo de `/analise/dashboard`. Polimento — pode ser deferido.

**Independent Test**: 6 cards de KPIs (faturamento mês, margem, recebido, pendente, despesas vencidas, saldo projetado), comparativos %, alertas só quando aplicável.

- [ ] T106 [P] [US5] `src/app/(dashboard)/analise/dashboard/page.tsx` — SSR agregando dados de `computeOperatingResult` + summaries das outras páginas
- [ ] T107 [P] [US5] `src/app/(dashboard)/analise/dashboard/kpi-card.tsx` — Card individual com valor + comparativo + ícone
- [ ] T108 [P] [US5] Smoke test `tests/components/financeiro/dashboard-kpi.test.tsx`

**Checkpoint**: opcional. US5 é polimento; não bloqueia merge se faltar tempo.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Validação final, ajustes globais, smoke manual.

- [ ] T109 [P] Rodar `pnpm typecheck` e corrigir qualquer erro
- [ ] T110 [P] Rodar `pnpm lint:auth` — garantir que cada route handler novo tem `requireRole(...)`
- [ ] T111 [P] Rodar `pnpm test` (suite completa) — verificar 100% verde (SC-009)
- [ ] T112 Cobrir manualmente o `quickstart.md` ponta a ponta — 10 cenários; documentar divergências como issue de follow-up
- [ ] T113 [P] Validar bundle size delta com `next build`: rotas novas em `/analise/*` — objetivo somar <30kb gzipped total
- [ ] T114 [P] Verificar acessibilidade DevTools (Lighthouse a11y ≥95) em `/analise/contas-a-receber` e `/analise/repasse-medico/[mes]` — corrigir aria ausentes
- [ ] T115 [P] Cobrir e expandir `src/lib/observability/errors.ts` para mapear novos códigos SQL (`window_expired`, `has_paid_payouts`, `already_closed`, `reason_too_short`) → HTTP status apropriados
- [ ] T116 Atualizar `CLAUDE.md` se houver convenção nova surgida durante implementação
- [ ] T117 [P] Verificar que `lib/core/reports/financial-report.ts` e `computeOperatingResult` continuam funcionando sem regressão (SC-010) — rodar `pnpm test tests/contract/api-relatorios*.spec.ts`
- [ ] T118 Auto-memory: criar `feedback_financeiro_append_only.md` em `~/.claude/projects/.../memory/` documentando padrão de versionamento + whitelist trigger reutilizável para futuras features

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup, T001-T003)**: zero dep, paralelo
- **Phase 2 (Foundational, T004-T021)**: depende de Phase 1; **BLOCKS toda US**
- **Phase 3 (US1, T022-T041)**: depende de Phase 2
- **Phase 4 (US2, T042-T061)**: depende de Phase 2
- **Phase 5 (US3, T062-T081)**: depende de Phase 2; consome dado de US1+US2 mas pode ser implementado em paralelo
- **Phase 6 (US4, T082-T105)**: depende de Phase 2
- **Phase 7 (US5, T106-T108)**: depende de Phase 5+6 (consome agregações)
- **Phase 8 (Polish, T109-T118)**: depende das US implementadas

### Cross-story dependencies

- US1, US2, US3, US4 podem ser implementadas **em paralelo** após Phase 2 (Foundational) concluída.
- US5 (Dashboard) só depois de US1-US4 prontas (agrega dados delas).

### Within each US

- Tipos (`types.ts`) ANTES de lib functions.
- Lib functions ANTES de API routes.
- API routes ANTES (ou em paralelo) de UI.
- Modals ANTES da integração com pages.
- Tests podem ser escritos em paralelo (não bloqueiam impl).

### Parallel Opportunities

- **Phase 1**: T001-T003 paralelos
- **Phase 2**: T005-T010 paralelos (ALTER + CREATE diferentes); T019-T021 paralelos (testes diferentes)
- **Phase 3-6**: dentro de cada US, todos `[P]` paralelos
- **Phase 8**: maioria `[P]`

---

## Parallel Example: User Story 1

```bash
# Phase 2 — Foundational (após Setup):
T004: helpers SQL
T005-T010: ALTER + 5 CREATEs (paralelos)
T011-T015: trigger functions + RPCs (sequencial dep)
T016: pnpm supabase:reset
T017: pnpm supabase:gen-types
T019-T021: testes foundationais (paralelos)

# Phase 3 — US1:
T022-T026 paralelos: 4 arquivos de types/lib
T027 depende de T023
T028 paralelo
T029-T032: API routes (cada uma é arquivo separado, paralelo)
T033-T037: UI (cada arquivo separado, paralelo)
T038-T041: testes (paralelos)
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. **Sprint 1**: Phase 1 + Phase 2 (Setup + Foundational) — destrava tudo.
2. **Sprint 2**: Phase 3 (US1) + Phase 4 (US2) em paralelo se houver 2 devs, ou sequencial.
3. **STOP and VALIDATE**: cenários 1-2 do quickstart. Já é deploy-ready.
4. Demo: clínica recebe valor imediato (vê o que cobrar e o que pagar).

### Incremental Delivery

1. Sprint 3: Phase 5 (US3 — Fluxo de Caixa). Deploy.
2. Sprint 4: Phase 6 (US4 — Repasse Médico). Deploy.
3. Sprint 5: Phase 7 (US5 — Dashboard) + Phase 8 (Polish). Merge final.

### Parallel Team Strategy

Com 3 devs após Foundational:

- Dev A: US1 + US2
- Dev B: US3 (fluxo de caixa + cash balance)
- Dev C: US4 (repasse — incluindo paridade test crítico)

---

## Notes

- **Tasks `[P]`** = arquivos diferentes, sem dependências pendentes.
- **SECURITY DEFINER** functions devem ser cuidadosamente testadas — escapam de RLS.
- **Princípio I** é o princípio mais sensível desta feature — triggers de append-only são a defesa principal.
- **Paridade SC-006**: o teste T101 é o mais crítico — falha aqui significa que clínica vê valores diferentes entre o DRE e o repasse, perda de confiança catastrófica.
- **Commit suggerido** após cada fase ou agrupamento lógico (ex.: "feat(023): foundational SQL — migration + RPCs", "feat(023): US1 — contas a receber", etc.).
- **Sem novo padrão de RBAC ou auditoria** — reutiliza `requireRole` + `log_audit_event` existentes.

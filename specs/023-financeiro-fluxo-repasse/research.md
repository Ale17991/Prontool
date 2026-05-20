# Phase 0 — Research

**Feature**: 023 — Financeiro robusto (Fluxo de Caixa, Contas a Pagar/Receber, Repasse Médico)
**Date**: 2026-05-20

Resolução das decisões técnicas pendentes antes da Phase 1.

---

## R1 — `paid_amount_cents` derivado de `installment_payments`

**Question**: Como manter `payment_installments.paid_amount_cents` consistente com a soma de `installment_payments` sem violar Princípio I (UPDATE em coluna financeira)?

**Decision**: **Trigger cacheado pós-INSERT em `installment_payments`** atualizando `payment_installments.paid_amount_cents` e `paid_at` (último). Embora seja tecnicamente um UPDATE em coluna "financeira", esta coluna passa a ter o papel de **cache derivado** (não fonte de verdade) — a verdade está em `installment_payments`. Trigger garante consistência atômica. A regra de negócio "valor original = `amount_cents`" continua imutável; o "valor pago" muda quando novos pagamentos são registrados, o que é semanticamente esperado.

**Rationale**:
- Performance: queries de listagem (contas a receber) precisam mostrar `paid_amount` rapidamente; SUM em runtime tem custo O(N) por parcela renderizada.
- Princípio I não é violado em espírito: o cache reflete operações append-only legítimas registradas em `installment_payments` (cada uma é uma operação auditada).
- Reversão de pagamento = INSERT de linha com `amount_cents` negativo (estorno) + `note` obrigatória → trigger recalcula. Forensia preservada.
- Migration documenta a coluna como "computed by trigger; do not UPDATE directly".

**Alternatives considered**:
- View materializada: complica refresh + RLS + invalidação. Mesma classe de complexidade que trigger sem ganho real.
- JOIN/SUM on-the-fly em cada query: lento em listas grandes (≥100 parcelas).

---

## R2 — Projeção de despesas recorrentes

**Question**: Despesas com `recurring=true frequency=mensal|semanal|anual` projetam até 90 dias à frente. Calcular server-side (PostgreSQL `generate_series`) ou client-side TypeScript?

**Decision**: **Client-side TypeScript** em `lib/core/accounts-payable/project-recurring.ts`. Função pura recebe array de despesas e janela (`fromDate`, `toDate`) e retorna projeções.

**Rationale**:
- Testabilidade: lógica de projeção é determinística; teste unitário sem DB é trivial.
- Versionamento: a função respeita `recurring_starts_at`/`recurring_ends_at`/`superseded_by` para cada despesa — lógica complexa fica em TS, fora de SQL.
- Performance: projeção de 30-80 despesas recorrentes em 90 dias = ≤500 linhas geradas, trivial em memória.
- Reuso: o fluxo de caixa também precisa dessas projeções (FR-020) — função compartilhada em `lib/core/cash-flow/`.

**Alternatives considered**:
- SQL `generate_series`: poderoso mas duplica regras de versionamento dentro de SQL; difícil testar e debugar.

---

## R3 — Agregação ≥500 eventos no fluxo de caixa

**Question**: FR-026 exige agregação semanal automática quando o conjunto excede 200 eventos no range visível. Onde aplicar?

**Decision**: **Client-side groupBy** em `lib/core/cash-flow/aggregate.ts`. Função pura recebe array de eventos e escala (diária/semanal/mensal); agrega via `date-fns startOfWeek/startOfMonth`.

**Rationale**:
- Mesmos eventos são consumidos pelo gráfico (recharts) e pela tabela (drilldown). Agregação no client evita 2x roundtrip.
- Troca de escala (FR-023) acontece sem refetch — só re-agregar.
- 500-2000 eventos em memória são triviais para JS.

**Alternatives considered**:
- `date_trunc` SQL com GROUP BY: força refetch a cada troca de escala. Pior UX.

---

## R4 — Trigger anti-UPDATE em tabelas append-only

**Question**: Como impedir UPDATE/DELETE em colunas calculadas de tabelas append-only sem bloquear updates legítimos em colunas de pagamento (`paid_at`, `paid_amount_cents` em `monthly_payouts`)?

**Decision**: **Trigger BEFORE UPDATE com whitelist de colunas alteráveis**. Para `monthly_payouts`, colunas que PODEM ser UPDATEadas: `paid_at`, `paid_amount_cents`, `payment_method`, `payment_note`, `closed_at`, `closed_by` (último par só pode ir a NULL via `reopen_monthly_payout`). Trigger detecta tentativa de UPDATE em outras colunas e RAISE EXCEPTION.

Para `installment_payments`, `monthly_payouts_adjustments`, `monthly_payouts_reopens`, `tenant_cash_balance_adjustments` — nenhuma coluna permite UPDATE. Trigger genérico bloqueia tudo.

**Pattern reusado**: a feature 011 (taxes) e 018 (appointment_reminders) já usam triggers similares. Vou criar helper SQL `enforce_append_only_columns(table_name, allowed_cols TEXT[])` para padronizar.

**Alternatives considered**:
- RLS policies para UPDATE: mais limitadas; difícil expressar "só estas colunas".
- Permissions SQL `GRANT UPDATE(col1, col2)`: funciona para roles autenticados via Supabase, mas o service_role bypassa (necessário em SECURITY DEFINER). Trigger é a única defesa robusta.

---

## R5 — `reopen_monthly_payout` + `snapshot_before`

**Question**: Antes de reabrir um mês (limpar `closed_at`), precisamos salvar o snapshot atual em `monthly_payouts_reopens.snapshot_before` (JSONB). Como serializar?

**Decision**: **Função SECURITY DEFINER constrói JSONB via `jsonb_agg(row_to_json(p.*))`** sobre `monthly_payouts` daquele mês × tenant, dentro de transação. Sequência:
1. Validar precondições (FR-032a): janela 24h + nenhum `paid_at`.
2. Selecionar snapshot atual em JSONB.
3. Inserir em `monthly_payouts_reopens` com `snapshot_before` populado.
4. UPDATE `monthly_payouts` zerando `closed_at`, `closed_by`.
5. Inserir entrada em `audit_log` via `log_audit_event(...)`.
6. Commit.

**Rationale**: tudo dentro de uma transação SQL garante atomicidade. JSONB permite restaurar valores exatos se for necessário (forense). `row_to_json` é leve e suporta tipos.

---

## R6 — Indexes

**Question**: Quais composites para queries mais comuns?

**Decision**:

| Tabela | Index | Justificativa |
|---|---|---|
| `installment_payments` | `(tenant_id, installment_id, paid_at desc)` | trigger de soma + histórico de parciais por parcela |
| `monthly_payouts` | `(tenant_id, month, doctor_id)` UNIQUE | lookup principal; UNIQUE evita duplicata |
| `monthly_payouts` | `(tenant_id, doctor_id, month desc)` | view "meus repasses dos últimos meses" do médico |
| `monthly_payouts` | `(tenant_id, closed_at) WHERE closed_at IS NOT NULL` | listar meses fechados rápido |
| `monthly_payouts_adjustments` | `(tenant_id, applied_month, doctor_id)` | lookup para incluir ajustes no próximo repasse |
| `monthly_payouts_reopens` | `(tenant_id, month)` | forense por mês |
| `tenant_cash_balance_adjustments` | `(tenant_id, effective_from desc)` | soma cumulativa até data D |
| `expenses` (existente) | NOVO partial: `(tenant_id, competence_date) WHERE paid_at IS NULL` | listar despesas pendentes (FR-010) |
| `expenses` (existente) | NOVO partial: `(tenant_id, recurring_starts_at) WHERE recurring = true AND recurring_ends_at IS NULL` | projeção recorrente |

**Rationale**: indexes parciais (com `WHERE`) reduzem tamanho e aceleram queries com filtros equivalentes. Pattern já em uso na feature 018 (lembretes).

---

## R7 — Estornos pós-fechamento: trigger automático

**Question**: Quando um atendimento de mês fechado é estornado (insert em `appointment_reversals`), o sistema deve gerar uma linha em `monthly_payouts_adjustments` automaticamente. Como?

**Decision**: **Trigger AFTER INSERT em `appointment_reversals`** que:
1. Lê o `appointment_id` do reversal.
2. Calcula `original_month` do atendimento (YEAR-MONTH no fuso do tenant).
3. Verifica se existe linha em `monthly_payouts` com `closed_at IS NOT NULL` para esse `(tenant_id, doctor_id, original_month)`.
4. Se sim: calcula `delta_cents` = - (valor da comissão / pagamento liberal do atendimento original) e insere em `monthly_payouts_adjustments` com `applied_month` = próximo mês não-fechado.
5. Se não (mês ainda aberto): não faz nada — o estorno afeta o cálculo ao vivo.

**Rationale**: automação reduz risco de admin esquecer. Trigger é a forma mais segura de garantir "todo estorno pós-fechamento vira ajuste".

**Pattern de Princípio I**: a tabela `appointment_reversals` é append-only existente; o trigger só lê dela e escreve em outra append-only. Sem violação.

---

## R8 — Paridade com `computeOperatingResult` (SC-006)

**Question**: SC-006 exige que valores em `monthly_payouts` batam exatamente com `computeOperatingResult` para o mesmo mês. Como garantir e testar?

**Decision**: A função `close_monthly_payout` MUST **reusar `computeOperatingResult` para todos os totais consolidados** (gross, commissions, fixed, liberal). Depois decompõe por médico usando as mesmas queries que `monthly_fixed_pay_lines` e `appointments_effective`. Snapshot resultante é uma reagregação do que `computeOperatingResult` já produz — paridade por construção.

**Teste**: `tests/integration/monthly-payout-paridade.spec.ts`:
1. Fixture com 5 médicos, 20 atendimentos no mês, 1 estorno, 2 médicos com payment_fixed, 1 com payment_liberal.
2. Rodar `computeOperatingResult(month)` e capturar `lines.commissionsCents`, `lines.fixedPaymentsCents`, `lines.liberalPaymentsCents`, `lines.grossRevenueCents`.
3. Rodar `close_monthly_payout(month)`.
4. Assertar: `SUM(monthly_payouts.commission_cents) == lines.commissionsCents` e similares.

**Alternatives considered**:
- Reescrever cálculos do zero em `close_monthly_payout`: risco alto de divergência.

---

## R9 — Reuso de RBAC e auditoria existentes

**Question**: Endpoints novos precisam do mesmo padrão de `requireRole(...)` + `log_audit_event(...)` das features anteriores?

**Decision**: **Sim, reusar 100%**. Todas as rotas em `app/api/financeiro/**/route.ts` começam com:

```ts
const session = await requireRole(['admin', 'financeiro'], {
  entity: 'monthly_payouts',
  entityId: ...,
  route: ...,
  request,
})
```

E toda mutação chama:

```ts
await supabase.rpc('log_audit_event', { ... })
```

Lint check existente (`scripts/check-require-role.mjs`) garante 100% de cobertura — se uma rota nova esquecer `requireRole`, build falha.

---

## R10 — UI: Sheet vs Modal para registrar pagamento

**Question**: Modal de "Registrar pagamento" na lista de contas a receber — usar `Sheet` (drawer lateral) ou `Dialog` (modal central)?

**Decision**: **Dialog (modal central)**. Razão: formulário curto (3-4 campos) + alta frequência → Dialog é mais rápido de abrir/fechar visualmente. Sheet fica melhor para formulários longos ou contextuais (como feature 019/020 fez para Sheet de nova evolução SOAP).

Consistência com `PrintChartButton` (feature 019) que também usa Dialog para formulário curto.

---

## Resumo de decisões

| ID | Decisão | Impacto |
|----|---------|---------|
| R1 | Trigger cache em `paid_amount_cents` derivado de `installment_payments` | Princípio I respeitado em espírito; performance preservada |
| R2 | Projeção recorrente client-side TS | Testável, reusável entre contas-a-pagar e fluxo-caixa |
| R3 | Agregação fluxo de caixa client-side | Troca de escala sem refetch |
| R4 | Trigger anti-UPDATE com whitelist via helper SQL `enforce_append_only_columns` | Defesa robusta vs. service_role bypass |
| R5 | `reopen_monthly_payout` salva snapshot JSONB via `row_to_json` em SECURITY DEFINER | Forense + atomicidade transacional |
| R6 | 9 indexes novos (composites + parciais) | Performance dos listings principais |
| R7 | Trigger AFTER INSERT em `appointment_reversals` gera ajustes automáticos | Automatiza correção pós-fechamento |
| R8 | `close_monthly_payout` reusa `computeOperatingResult` para totais | Paridade SC-006 por construção |
| R9 | Reusar `requireRole` + `log_audit_event` padrões | Zero novo padrão; consistência total |
| R10 | Dialog (não Sheet) para "Registrar pagamento" | UX rápida para formulário curto |

Nenhuma decisão aberta. Phase 1 pode prosseguir.

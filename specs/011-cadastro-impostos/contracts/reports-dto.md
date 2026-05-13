# Contract — Relatórios e Dashboard (DTO changes)

> Cobre US4 (impacto em relatórios e dashboard). Estende DTOs internos servidos por `src/lib/core/reports/`. Não há rota HTTP nova — os relatórios são SSR pages que consomem essas funções.

## Funções afetadas

| Função | Arquivo | Mudança |
|---|---|---|
| `buildFinancialReport` | `src/lib/core/reports/financial-report.ts` | Adiciona `taxTotals` ao DTO; separa categoria `impostos` em `expensesByCategory` |
| `buildByPlan` (summary + detail) | `src/lib/core/reports/by-plan.ts` | Adiciona `taxFromPlanCents` por plano; novo total `totalTaxFromPlanCents` |
| `exportFinancialExcel` / `exportByPlanExcel` | mesmos paths `-excel.ts` | Replica as novas linhas no Excel/PDF |

---

## 1) FinancialReport DTO (extensão)

### Novo campo `taxTotals`

```ts
interface FinancialReport {
  // ... campos existentes
  taxTotals: {
    fromPlansCents: number      // ∑ por plano: round(grossRevenue * tax_rate_bps / 10000)
    fromExpensesCents: number   // ∑ expenses.amount_cents WHERE category='impostos'
    totalCents: number          // fromPlansCents + fromExpensesCents
  }
}
```

### `expensesByCategory` (regra de cálculo atualizada)

A linha `category='impostos'` continua aparecendo na lista. Mas o consumidor do dashboard agora a usa para popular o componente "Impostos da clínica" do novo card "Impostos" — sem mudança de schema do DTO.

### `operatingProfitCents` (fórmula reforçada — sem mudança do shape)

```
operatingProfit = netRevenue                                  // já existente
                − taxTotals.fromPlansCents                    // NOVO desconto
                − totalExpensesCents (incl. impostos)         // já existente
```

> _Atenção_: `totalExpensesCents` já contém despesas categorizadas como 'impostos'. O `taxTotals.fromExpensesCents` é um **recorte** dentro de `totalExpensesCents`, não uma adição. **Não há dupla contagem**. A fórmula:
>
> `lucro = (faturamento − comissões − imposto_do_convênio) − (despesas_operacionais + impostos_da_clínica)`
>
> é equivalente a `netRevenue − taxFromPlans − totalExpenses` quando `totalExpenses = despesas_operacionais + impostos_da_clínica`. Por isso `operatingProfit` continua sendo computado como `netRevenue − totalExpenses − taxFromPlans`.

### Implementação (server-side)

```ts
// dentro de buildFinancialReport, após carregar appointments por plano:
const plansRes = await supabase
  .from('health_plans')
  .select('id, tax_rate_bps')
  .eq('tenant_id', tenantId)
  .in('id', revenueByPlan.map(r => r.planId).filter(Boolean))
const planTaxMap = new Map<string, number>(
  (plansRes.data ?? []).map(p => [p.id, p.tax_rate_bps ?? 0])
)

let taxFromPlansCents = 0
for (const row of revenueByPlan) {
  const bps = planTaxMap.get(row.planId) ?? 0
  const tax = Math.round(row.grossRevenueCents * bps / 10000)
  // expomos no row (campo novo) — opcional, ver §UI abaixo
  ;(row as RevenueByPlanRow & { taxRateBps: number; taxFromPlanCents: number })
    .taxRateBps = bps
  ;(row as RevenueByPlanRow & { taxRateBps: number; taxFromPlanCents: number })
    .taxFromPlanCents = tax
  taxFromPlansCents += tax
}

const taxExpensesRow = expensesByCategory.find(c => c.category === 'impostos')
const taxFromExpensesCents = taxExpensesRow?.totalCents ?? 0

const taxTotals = {
  fromPlansCents: taxFromPlansCents,
  fromExpensesCents: taxFromExpensesCents,
  totalCents: taxFromPlansCents + taxFromExpensesCents,
}

const operatingProfitCents = netRevenueCents - totalExpensesCents - taxFromPlansCents
```

### Diferenças no comparativo de período anterior

`previous` também ganha `taxFromPlansCents` (computado pela mesma rotina aplicada a `previousAppointments`). Sem isso, `comparison.profitPct` ficaria viesado.

---

## 2) `RevenueByPlanRow` (extensão)

```ts
interface RevenueByPlanRow {
  planId: string
  planName: string
  appointmentCount: number
  grossRevenueCents: number
  marketSharePct: number
  // NOVOS:
  taxRateBps: number             // alíquota corrente do plano (0 se "não cobra")
  taxFromPlanCents: number       // round(grossRevenueCents * taxRateBps / 10000)
  netOfPlanTaxCents: number      // grossRevenueCents - taxFromPlanCents (conveniência UI)
}
```

> Não há renome/break — campos existentes intactos.

---

## 3) `buildByPlan` (relatório por plano)

### `PlanSummaryRow` (extensão)

```ts
interface PlanSummaryRow {
  planId: string
  planName: string
  procedureCount: number
  totalRevenueCents: number
  // NOVO:
  taxRateBps: number
  taxFromPlanCents: number
  netOfPlanTaxCents: number
}
```

### `PlanDetail` (extensão)

```ts
interface PlanDetail {
  // ... campos existentes
  totals: {
    procedureCount: number
    totalRevenueCents: number
    // NOVOS:
    taxRateBps: number
    taxFromPlanCents: number
    netOfPlanTaxCents: number
  }
}
```

### UI no `relatorios/page.tsx`

- Para cada `RevenueByPlanRow`, a linha do plano passa a ter 3 colunas: Bruto, Imposto do convênio (−), Líquido.
- Se `taxRateBps === 0`, a UI pode optar por suprimir a linha de imposto (US4 AC4). Implementação atual: mostra `R$ 0,00` (mais didático).

### Novo card "Impostos" no dashboard

Componente novo (Server Component) que recebe `taxTotals` e renderiza:

```
┌─ Impostos ──────────────────────────┐
│  R$ 9.250,00                        │  ← total
│  ┌ 6.500 do convênio                │
│  └ 2.750 da clínica                 │  (lista expandível)
└─────────────────────────────────────┘
```

---

## 4) Excel/PDF exports

`exportFinancialExcel` e `exportByPlanExcel` recebem o mesmo DTO ampliado e adicionam:
- **Aba "Impostos"** com tabela de impostos por plano e impostos da clínica.
- Coluna "Imposto do convênio" inserida entre Bruto e Líquido em cada plano.
- Linha "Total impostos" no rodapé do resumo financeiro.

PDF (se houver): mesma estrutura visual.

---

## Compatibilidade

- Todos os campos novos são **adições**; nenhum existente é renomeado ou removido.
- Consumidores legados (testes antigos do JSON DTO) seguem funcionando — campos extras são tolerados.
- Excel/PDF: novos consumidores leem novas colunas; downloads antigos cacheados não regredem.

---

## Testes exigidos

| Arquivo | Cenários |
|---|---|
| `tests/integration/reports-with-taxes.test.ts` | Cria plano com `tax_rate_bps=650` + 1 atendimento R$ 100; espera `taxFromPlanCents=650` |
| `tests/integration/reports-zero-rate-plan.test.ts` | Plano com `tax_rate_bps=0` ⇒ `taxFromPlanCents=0`, `operatingProfit` inalterado |
| `tests/integration/reports-multi-plan-rounding.test.ts` | 3 planos com bps diferentes em R$ 333; verifica soma dos arredondamentos ≤ 1 centavo de divergência |
| `tests/integration/financial-report-tax-card.test.ts` | `taxTotals.totalCents = fromPlansCents + fromExpensesCents` |
| `tests/integration/by-plan-detail-tax.test.ts` | `PlanDetail.totals.netOfPlanTaxCents === totalRevenueCents - taxFromPlanCents` |

---

## Notas de implementação

- Helper `applyPlanTax(rows, planTaxMap)` extraído para `src/lib/core/reports/apply-plan-tax.ts` — uma só fonte de verdade do cálculo (DRY entre `buildFinancialReport` e `buildByPlan`).
- Para `taxFromPlansCents`, agregamos no nível de plano (e não por linha de procedimento) — ver Decisão 9 do research.md.
- O query plan adicional para puxar `tax_rate_bps`: 1 select extra em `health_plans` (filter por ids in [...]) — irrisório.

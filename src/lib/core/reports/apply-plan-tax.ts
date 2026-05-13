/**
 * T063 (Feature 011 — US4) — aplica imposto do convênio sobre as linhas
 * de receita por plano.
 *
 * Cálculo: `taxFromPlanCents = round(grossRevenueCents * tax_rate_bps / 10000)`
 * Math.round = half-away-from-zero (padrão JS, coerente com o resto do
 * codebase financeiro — ver financial-report.ts:164).
 *
 * Função pura — testes em tests/integration/reports-* + helpers cobrem
 * arredondamento, planos com bps=0 e agregação.
 */

export interface PlanTaxRow {
  planId: string
  grossRevenueCents: number
}

export interface PlanTaxResult<T extends PlanTaxRow> {
  rows: Array<
    T & { taxRateBps: number; taxFromPlanCents: number; netOfPlanTaxCents: number }
  >
  totalTaxCents: number
}

export function applyPlanTax<T extends PlanTaxRow>(
  rows: T[],
  planTaxMap: Map<string, number>,
): PlanTaxResult<T> {
  let totalTaxCents = 0
  const enriched = rows.map((row) => {
    const bps = planTaxMap.get(row.planId) ?? 0
    const taxFromPlanCents = Math.round((row.grossRevenueCents * bps) / 10000)
    totalTaxCents += taxFromPlanCents
    return {
      ...row,
      taxRateBps: bps,
      taxFromPlanCents,
      netOfPlanTaxCents: row.grossRevenueCents - taxFromPlanCents,
    }
  })
  return { rows: enriched, totalTaxCents }
}

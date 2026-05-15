import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { selectMonthlyFixedPayLines } from './monthly-fixed-pay-lines'

export interface OperatingResultLines {
  grossRevenueCents: number
  commissionsCents: number
  fixedPaymentsCents: number
  liberalPaymentsCents: number
  taxesCents: number
  operatingExpensesCents: number
  netProfitCents: number
}

export interface OperatingResult {
  month: string // YYYY-MM
  lines: OperatingResultLines
  drilldowns: {
    commissions: string
    fixed: string
    liberal: string
    taxes: string
    operating: string
  }
}

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Computa o resultado operacional do mês (feature 013 US3, FR-024):
 *   gross_revenue − commissions − fixed_payments − liberal_payments
 *                 − taxes − operating_expenses = net_profit
 *
 * Cada termo é uma query simples sobre tabelas/views existentes:
 *   - gross & commissions: appointments_effective (status ativo)
 *   - fixed_payments: view monthly_fixed_pay_lines
 *   - liberal_payments: appointment_assistants (removed_at IS NULL) joinado
 *     com appointments — exclui estornados via NOT EXISTS appointment_reversals
 *   - taxes & operating: expenses, separando categoria 'tax'
 */
export async function computeOperatingResult(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; month: string },
): Promise<OperatingResult> {
  if (!MONTH_REGEX.test(args.month)) {
    throw new ValidationError("month deve estar no formato 'YYYY-MM'")
  }
  const [yStr, mStr] = args.month.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const fromDate = new Date(Date.UTC(year, month - 1, 1))
  const toDate = new Date(Date.UTC(year, month, 1))
  const fromIso = fromDate.toISOString()
  const toIso = toDate.toISOString()
  const fromDateStr = fromDate.toISOString().slice(0, 10)
  const toDateStr = toDate.toISOString().slice(0, 10)

  // 1) Gross + commissions: appointments_effective no mês com status 'ativo'.
  const { data: apptRaw, error: apptErr } = await supabase
    .from('appointments_effective')
    .select('frozen_amount_cents, net_commission_cents, effective_status, appointment_at')
    .eq('tenant_id', args.tenantId)
    .gte('appointment_at', fromIso)
    .lt('appointment_at', toIso)
  if (apptErr) {
    throw new Error(`operating-result appointments_effective: ${apptErr.message}`)
  }
  let grossRevenueCents = 0
  let commissionsCents = 0
  const activeAppointmentIds: string[] = []
  for (const r of (apptRaw ?? []) as Array<{
    frozen_amount_cents: number | null
    net_commission_cents: number | null
    effective_status: string | null
  }>) {
    if (r.effective_status === 'estornado') continue
    grossRevenueCents += r.frozen_amount_cents ?? 0
    commissionsCents += r.net_commission_cents ?? 0
  }

  // 2) Fixed payments do mês via view.
  const fixedLines = await selectMonthlyFixedPayLines(supabase, {
    tenantId: args.tenantId,
    year,
    month,
  })
  const fixedPaymentsCents = fixedLines.reduce((s, l) => s + l.amountCents, 0)

  // 3) Liberal payments — sum frozen_amount_cents de assistants ativos cujo
  //    appointment está no mês E não foi estornado. Faz em duas queries:
  //    primeiro carrega assistants do tenant ativos no mês, depois filtra
  //    pelo conjunto de appointment_ids estornados.
  const { data: assistRaw, error: assistErr } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'frozen_amount_cents, appointment_id, appointment:appointment_id ( appointment_at )',
    )
    .eq('tenant_id', args.tenantId)
    .is('removed_at', null)
  if (assistErr) {
    // best-effort — se a migration ainda não aplicou, considera 0.
    void assistErr
  }
  const assistRows = (assistRaw ?? []) as unknown as Array<{
    frozen_amount_cents: number
    appointment_id: string
    appointment: { appointment_at: string | null } | null
  }>
  const assistInMonth = assistRows.filter((r) => {
    const at = r.appointment?.appointment_at
    if (!at) return false
    const t = new Date(at).getTime()
    return t >= fromDate.getTime() && t < toDate.getTime()
  })
  let liberalPaymentsCents = 0
  if (assistInMonth.length > 0) {
    const apptIds = Array.from(new Set(assistInMonth.map((r) => r.appointment_id)))
    const { data: reversalsRaw } = await supabase
      .from('appointment_reversals')
      .select('appointment_id')
      .in('appointment_id', apptIds)
    const reversedSet = new Set(
      ((reversalsRaw ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
    )
    for (const r of assistInMonth) {
      if (reversedSet.has(r.appointment_id)) continue
      liberalPaymentsCents += r.frozen_amount_cents
    }
  }
  void activeAppointmentIds

  // 4) Taxes + operating expenses — feature 011 (0076) adicionou `tax_id`
  //    em expenses; despesas com tax_id != NULL são impostos. Demais
  //    categorias entram em operating_expenses.
  const { data: expRaw, error: expErr } = await supabase
    .from('expenses')
    .select('amount_cents, tax_id, competence_date, deleted_at')
    .eq('tenant_id', args.tenantId)
    .gte('competence_date', fromDateStr)
    .lt('competence_date', toDateStr)
  if (expErr) {
    throw new Error(`operating-result expenses: ${expErr.message}`)
  }
  let taxesCents = 0
  let operatingExpensesCents = 0
  for (const r of (expRaw ?? []) as Array<{
    amount_cents: number | null
    tax_id: string | null
    deleted_at: string | null
  }>) {
    if (r.deleted_at) continue
    const amt = r.amount_cents ?? 0
    if (r.tax_id) {
      taxesCents += amt
    } else {
      operatingExpensesCents += amt
    }
  }

  const netProfitCents =
    grossRevenueCents -
    commissionsCents -
    fixedPaymentsCents -
    liberalPaymentsCents -
    taxesCents -
    operatingExpensesCents

  return {
    month: args.month,
    lines: {
      grossRevenueCents,
      commissionsCents,
      fixedPaymentsCents,
      liberalPaymentsCents,
      taxesCents,
      operatingExpensesCents,
      netProfitCents,
    },
    drilldowns: {
      commissions: `/relatorios/por-profissional?from=${fromDateStr}&to=${toDateStr}&payment_mode=comissionado`,
      fixed: `/relatorios/mensal?month=${args.month}&filter=fixed_pay_lines`,
      liberal: `/relatorios/por-profissional?from=${fromDateStr}&to=${toDateStr}&payment_mode=liberal`,
      taxes: `/relatorios/despesas?from=${fromDateStr}&to=${toDateStr}&category=tax`,
      operating: `/relatorios/despesas?from=${fromDateStr}&to=${toDateStr}&category=other`,
    },
  }
}

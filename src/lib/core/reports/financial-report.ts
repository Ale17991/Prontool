import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { applyPlanTax } from './apply-plan-tax'

/**
 * Relatório financeiro consolidado de um período arbitrário [from, to]:
 * receita por plano (com market share), top 5 profissionais, top 10
 * procedimentos, despesas por categoria, totais (faturamento bruto,
 * comissões, receita líquida, despesas, lucro operacional, margem) e
 * comparativo com o período imediatamente anterior do mesmo tamanho.
 *
 * Reaproveita appointments_effective (já considera estornos via
 * net_amount_cents) e expenses (filtradas por deleted_at IS NULL).
 *
 * Mesmo DTO consumido pelo JSON, PDF e Excel — paridade numérica
 * garantida (mesmo princípio do MonthlyReport).
 */
export interface FinancialReportInput {
  tenantId: string
  from: string
  to: string
}

export interface RevenueByPlanRow {
  planId: string
  planName: string
  appointmentCount: number
  grossRevenueCents: number
  marketSharePct: number
  // Feature 011 — US4
  taxRateBps: number
  taxFromPlanCents: number
  netOfPlanTaxCents: number
}

export interface TaxTotals {
  fromPlansCents: number
  fromExpensesCents: number
  totalCents: number
}

export interface DoctorRankingRow {
  doctorId: string
  doctorName: string
  grossRevenueCents: number
  appointmentCount: number
}

export interface ProcedureRankingRow {
  procedureId: string
  procedureName: string
  tussCode: string
  count: number
  totalCents: number
}

export interface ExpenseCategoryRow {
  category: string
  count: number
  totalCents: number
  pct: number
}

export interface FinancialTotals {
  grossRevenueCents: number
  commissionsCents: number
  netRevenueCents: number
  totalExpensesCents: number
  operatingProfitCents: number
  operatingMarginPct: number
  appointmentCount: number
}

export interface PreviousPeriodTotals {
  grossRevenueCents: number
  totalExpensesCents: number
  operatingProfitCents: number
  appointmentCount: number
  // Feature 011 — US4
  taxFromPlansCents: number
}

export interface PeriodComparison {
  revenuePct: number | null
  expensesPct: number | null
  profitPct: number | null
}

export interface DailyRevenuePoint {
  date: string
  grossRevenueCents: number
  appointmentCount: number
}

export interface FinancialReport {
  period: { from: string; to: string }
  previousPeriod: { from: string; to: string }
  revenueByPlan: RevenueByPlanRow[]
  topDoctors: DoctorRankingRow[]
  topProcedures: ProcedureRankingRow[]
  expensesByCategory: ExpenseCategoryRow[]
  totals: FinancialTotals
  previous: PreviousPeriodTotals
  comparison: PeriodComparison
  dailyRevenue: DailyRevenuePoint[]
  // Feature 011 — US4
  taxTotals: TaxTotals
}

interface AppointmentRow {
  id: string
  plan_id: string
  doctor_id: string
  procedure_id: string
  appointment_at: string
  net_amount_cents: number | null
  net_commission_cents: number | null
  effective_status: string | null
  health_plans: { name: string } | null
  doctors: { full_name: string } | null
  procedures: { tuss_code: string; display_name: string | null } | null
}

interface ProcedureLineRow {
  appointment_id: string
  procedure_id: string
  plan_id: string | null
  /** Valor UNITARIO em cents (migration 0081). */
  line_amount_cents: number
  /** Multiplicador (default 1). */
  quantity: number
  procedures: { tuss_code: string; display_name: string | null } | null
  health_plans: { name: string } | null
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export async function buildFinancialReport(
  supabase: SupabaseClient<Database>,
  input: FinancialReportInput,
): Promise<FinancialReport> {
  if (!DATE_REGEX.test(input.from) || !DATE_REGEX.test(input.to)) {
    throw new ValidationError('Parâmetros from/to devem estar no formato YYYY-MM-DD')
  }
  if (input.from > input.to) {
    throw new ValidationError('Parâmetro `from` não pode ser posterior a `to`')
  }

  const previousPeriod = computePreviousPeriod(input.from, input.to)

  const [current, previousAppointments, expenses, previousExpenses] = await Promise.all([
    fetchAppointments(supabase, input.tenantId, input.from, input.to),
    fetchAppointmentsTotals(supabase, input.tenantId, previousPeriod.from, previousPeriod.to),
    fetchExpenses(supabase, input.tenantId, input.from, input.to),
    fetchExpenses(supabase, input.tenantId, previousPeriod.from, previousPeriod.to),
  ])

  // Linhas de procedimento dos atendimentos ativos no periodo (feature
  // multi-procedimento). Quando todos os atendimentos sao single-line, o
  // resultado e identico ao agregado anterior; quando ha multi-procedimento,
  // cada linha contribui sob seu proprio plano.
  const activeIds = current.filter((r) => r.effective_status === 'ativo').map((r) => r.id)
  const lines = await fetchProcedureLines(supabase, input.tenantId, activeIds)

  const revenueByPlanRaw = aggregateByPlanFromLines(lines)
  const topDoctors = aggregateTopDoctors(current, 5)
  const topProcedures = aggregateTopProceduresFromLines(lines, 10)
  const expensesByCategory = aggregateExpensesByCategory(expenses)
  const dailyRevenue = aggregateDailyRevenue(current, input.from, input.to)

  // Feature 011 — US4: aplica tax_rate_bps de cada plano para deduzir
  // "Imposto do convênio" das linhas de receita.
  const planTaxMap = await fetchPlanTaxRates(
    supabase,
    input.tenantId,
    revenueByPlanRaw.map((r) => r.planId).filter((id) => id !== ''),
  )
  const enrichedByPlan = applyPlanTax(revenueByPlanRaw, planTaxMap)
  const revenueByPlan: RevenueByPlanRow[] = enrichedByPlan.rows
  const taxFromPlansCents = enrichedByPlan.totalTaxCents

  // Imposto da clínica = soma das despesas categorizadas como 'impostos'.
  const taxExpensesRow = expensesByCategory.find((c) => c.category === 'impostos')
  const taxFromExpensesCents = taxExpensesRow?.totalCents ?? 0

  const taxTotals: TaxTotals = {
    fromPlansCents: taxFromPlansCents,
    fromExpensesCents: taxFromExpensesCents,
    totalCents: taxFromPlansCents + taxFromExpensesCents,
  }

  const grossRevenueCents = current.reduce((acc, r) => acc + (r.net_amount_cents ?? 0), 0)
  const commissionsCents = current.reduce(
    (acc, r) => acc + (r.net_commission_cents ?? 0),
    0,
  )
  const netRevenueCents = grossRevenueCents - commissionsCents
  const totalExpensesCents = expenses.totalCents
  // lucro = netRevenue − totalExpenses − imposto_do_convênio.
  // Despesas de categoria 'impostos' já fazem parte de totalExpensesCents,
  // representando o "imposto da clínica" — não há dupla contagem.
  const operatingProfitCents = netRevenueCents - totalExpensesCents - taxFromPlansCents
  const operatingMarginPct =
    grossRevenueCents > 0
      ? Math.round((operatingProfitCents / grossRevenueCents) * 1000) / 10
      : 0

  // Previous period: mesmo cálculo, mantendo paridade do KPI de margem.
  const previousNetRevenue =
    previousAppointments.grossRevenueCents - previousAppointments.commissionsCents
  const previousTaxFromPlansCents = await computeTaxFromPlansForPeriod(
    supabase,
    input.tenantId,
    previousPeriod.from,
    previousPeriod.to,
  )
  const previousProfit =
    previousNetRevenue - previousExpenses.totalCents - previousTaxFromPlansCents

  return {
    period: { from: input.from, to: input.to },
    previousPeriod,
    revenueByPlan,
    topDoctors,
    topProcedures,
    expensesByCategory,
    totals: {
      grossRevenueCents,
      commissionsCents,
      netRevenueCents,
      totalExpensesCents,
      operatingProfitCents,
      operatingMarginPct,
      appointmentCount: current.length,
    },
    previous: {
      grossRevenueCents: previousAppointments.grossRevenueCents,
      totalExpensesCents: previousExpenses.totalCents,
      operatingProfitCents: previousProfit,
      appointmentCount: previousAppointments.appointmentCount,
      taxFromPlansCents: previousTaxFromPlansCents,
    },
    comparison: {
      revenuePct: pctChange(grossRevenueCents, previousAppointments.grossRevenueCents),
      expensesPct: pctChange(totalExpensesCents, previousExpenses.totalCents),
      profitPct: pctChange(operatingProfitCents, previousProfit),
    },
    dailyRevenue,
    taxTotals,
  }
}

/**
 * Feature 011 — US4 — carrega tax_rate_bps de planos por id.
 */
async function fetchPlanTaxRates(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planIds: string[],
): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('health_plans')
    .select('id, tax_rate_bps')
    .eq('tenant_id', tenantId)
    .in('id', planIds)
  if (error) throw new Error(`fetchPlanTaxRates failed: ${error.message}`)
  const map = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; tax_rate_bps?: number }>) {
    map.set(row.id, row.tax_rate_bps ?? 0)
  }
  return map
}

/**
 * Calcula tax_from_plans para um período arbitrário — usado no comparativo
 * do período anterior para preservar paridade do delta de lucro.
 */
async function computeTaxFromPlansForPeriod(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  from: string,
  to: string,
): Promise<number> {
  const fromTs = `${from}T00:00:00Z`
  const toExclusiveTs = nextDayIso(to)
  // Fetch appointment ids ativos no período + suas linhas (mesma estrutura
  // do principal, mas só o necessário para totalizar por plano).
  const PAGE_SIZE = 1000
  const activeIds: string[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select('id, effective_status')
      .eq('tenant_id', tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusiveTs)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error)
      throw new Error(`computeTaxFromPlansForPeriod ids failed: ${error.message}`)
    const page = (data ?? []) as Array<{ id: string; effective_status: string | null }>
    for (const r of page) if (r.effective_status === 'ativo') activeIds.push(r.id)
    if (page.length < PAGE_SIZE) break
  }
  if (activeIds.length === 0) return 0
  const lines = await fetchProcedureLines(supabase, tenantId, activeIds)
  const planRevenue = new Map<string, number>()
  for (const l of lines) {
    if (!l.plan_id) continue
    const qty = l.quantity || 1
    planRevenue.set(
      l.plan_id,
      (planRevenue.get(l.plan_id) ?? 0) + l.line_amount_cents * qty,
    )
  }
  if (planRevenue.size === 0) return 0
  const planTaxMap = await fetchPlanTaxRates(supabase, tenantId, Array.from(planRevenue.keys()))
  let total = 0
  for (const [planId, gross] of planRevenue) {
    const bps = planTaxMap.get(planId) ?? 0
    total += Math.round((gross * bps) / 10000)
  }
  return total
}

async function fetchAppointments(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  from: string,
  to: string,
): Promise<AppointmentRow[]> {
  const fromTs = `${from}T00:00:00Z`
  const toExclusiveTs = nextDayIso(to)

  const PAGE_SIZE = 1000
  const rows: AppointmentRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select(
        'id, plan_id, doctor_id, procedure_id, appointment_at, net_amount_cents, net_commission_cents, effective_status, health_plans(name), doctors(full_name), procedures(tuss_code, display_name)',
      )
      .eq('tenant_id', tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusiveTs)
      .order('appointment_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`buildFinancialReport query failed: ${error.message}`)
    const page = (data ?? []) as unknown as AppointmentRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function fetchAppointmentsTotals(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  from: string,
  to: string,
): Promise<{ grossRevenueCents: number; commissionsCents: number; appointmentCount: number }> {
  const rows = await fetchAppointments(supabase, tenantId, from, to)
  let gross = 0
  let comm = 0
  for (const r of rows) {
    gross += r.net_amount_cents ?? 0
    comm += r.net_commission_cents ?? 0
  }
  return { grossRevenueCents: gross, commissionsCents: comm, appointmentCount: rows.length }
}

// Feature 011 — US4: tipo intermediário usado antes do applyPlanTax adicionar
// taxRateBps/taxFromPlanCents/netOfPlanTaxCents.
type RawRevenueByPlanRow = Omit<
  RevenueByPlanRow,
  'taxRateBps' | 'taxFromPlanCents' | 'netOfPlanTaxCents'
>

function aggregateByPlanFromLines(lines: ProcedureLineRow[]): RawRevenueByPlanRow[] {
  // Receita = line_amount_cents (UNITARIO) * quantity. Migration 0081.
  const totalGross = lines.reduce(
    (acc, l) => acc + l.line_amount_cents * (l.quantity || 1),
    0,
  )
  const map = new Map<string, RawRevenueByPlanRow>()
  // Para appointmentCount por plano: contamos atendimentos distintos que
  // contem AO MENOS uma linha sob esse plano.
  const planAppointments = new Map<string, Set<string>>()
  for (const l of lines) {
    const key = l.plan_id ?? '__particular__'
    const existing = map.get(key) ?? {
      planId: l.plan_id ?? '',
      planName: l.health_plans?.name ?? 'Particular',
      appointmentCount: 0,
      grossRevenueCents: 0,
      marketSharePct: 0,
    }
    existing.grossRevenueCents += l.line_amount_cents * (l.quantity || 1)
    map.set(key, existing)

    let set = planAppointments.get(key)
    if (!set) {
      set = new Set()
      planAppointments.set(key, set)
    }
    set.add(l.appointment_id)
  }
  for (const [key, row] of map) {
    row.appointmentCount = planAppointments.get(key)?.size ?? 0
  }
  const out = Array.from(map.values())
  for (const row of out) {
    row.marketSharePct =
      totalGross > 0 ? Math.round((row.grossRevenueCents / totalGross) * 1000) / 10 : 0
  }
  return out.sort((a, b) => b.grossRevenueCents - a.grossRevenueCents)
}

function aggregateTopDoctors(rows: AppointmentRow[], limit: number): DoctorRankingRow[] {
  const map = new Map<string, DoctorRankingRow>()
  for (const r of rows) {
    const existing = map.get(r.doctor_id) ?? {
      doctorId: r.doctor_id,
      doctorName: r.doctors?.full_name ?? '—',
      grossRevenueCents: 0,
      appointmentCount: 0,
    }
    existing.grossRevenueCents += r.net_amount_cents ?? 0
    existing.appointmentCount += 1
    map.set(r.doctor_id, existing)
  }
  return Array.from(map.values())
    .sort((a, b) => b.grossRevenueCents - a.grossRevenueCents)
    .slice(0, limit)
}

function aggregateTopProceduresFromLines(
  lines: ProcedureLineRow[],
  limit: number,
): ProcedureRankingRow[] {
  const map = new Map<string, ProcedureRankingRow>()
  for (const l of lines) {
    const qty = l.quantity || 1
    const existing = map.get(l.procedure_id) ?? {
      procedureId: l.procedure_id,
      procedureName: l.procedures?.display_name ?? l.procedures?.tuss_code ?? '—',
      tussCode: l.procedures?.tuss_code ?? '',
      count: 0,
      totalCents: 0,
    }
    // Ranking de "mais realizados" considera quantidade — 1 linha qty=3
    // soma 3 ao count.
    existing.count += qty
    existing.totalCents += l.line_amount_cents * qty
    map.set(l.procedure_id, existing)
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.totalCents - a.totalCents)
    .slice(0, limit)
}

async function fetchProcedureLines(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentIds: string[],
): Promise<ProcedureLineRow[]> {
  if (appointmentIds.length === 0) return []

  const PAGE_SIZE = 1000
  const all: ProcedureLineRow[] = []
  // appointment_ids pode ser grande — paginamos com .in() em chunks
  // (PostgREST aceita ate ~2000 elementos por IN, mas usamos 500 como seguro).
  const CHUNK = 500
  for (let i = 0; i < appointmentIds.length; i += CHUNK) {
    const ids = appointmentIds.slice(i, i + CHUNK)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('appointment_procedures' as never)
        .select(
          'appointment_id, procedure_id, plan_id, line_amount_cents, quantity, ' +
            'procedures:procedure_id(tuss_code, display_name), health_plans:plan_id(name)',
        )
        .eq('tenant_id', tenantId)
        .in('appointment_id', ids)
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        // Ambiente sem migration 0069 — retorna vazio. O reportador
        // ainda gera as outras secoes (topDoctors, totals, etc.).
        if (/relation .*appointment_procedures.* does not exist/i.test(error.message)) {
          return []
        }
        throw new Error(`fetchProcedureLines failed: ${error.message}`)
      }
      const page = (data ?? []) as unknown as ProcedureLineRow[]
      all.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return all
}

interface ExpenseAggregation {
  byCategory: Map<string, { count: number; totalCents: number }>
  totalCents: number
}

async function fetchExpenses(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  from: string,
  to: string,
): Promise<ExpenseAggregation> {
  const { data, error } = await supabase
    .from('expenses')
    .select('category, amount_cents')
    .eq('tenant_id', tenantId)
    .gte('competence_date', from)
    .lte('competence_date', to)
    .is('deleted_at', null)

  if (error) throw new Error(`fetchExpenses failed: ${error.message}`)

  const byCategory = new Map<string, { count: number; totalCents: number }>()
  let totalCents = 0
  for (const row of data ?? []) {
    const amount = Number(row.amount_cents)
    totalCents += amount
    const existing = byCategory.get(row.category) ?? { count: 0, totalCents: 0 }
    existing.count += 1
    existing.totalCents += amount
    byCategory.set(row.category, existing)
  }
  return { byCategory, totalCents }
}

function aggregateExpensesByCategory(agg: ExpenseAggregation): ExpenseCategoryRow[] {
  const total = agg.totalCents
  return Array.from(agg.byCategory.entries())
    .map(([category, value]) => ({
      category,
      count: value.count,
      totalCents: value.totalCents,
      pct: total > 0 ? Math.round((value.totalCents / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
}

function aggregateDailyRevenue(
  rows: AppointmentRow[],
  from: string,
  to: string,
): DailyRevenuePoint[] {
  const map = new Map<string, DailyRevenuePoint>()
  // Pre-fill all dates so the chart has continuous x-axis.
  for (const date of dateRangeYmd(from, to)) {
    map.set(date, { date, grossRevenueCents: 0, appointmentCount: 0 })
  }
  for (const r of rows) {
    const date = r.appointment_at.slice(0, 10)
    const existing = map.get(date)
    if (!existing) continue // shouldn't happen given range filter
    existing.grossRevenueCents += r.net_amount_cents ?? 0
    existing.appointmentCount += 1
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function computePreviousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  // Same length of days, immediately preceding the current period.
  const fromDate = new Date(`${from}T00:00:00Z`)
  const toDate = new Date(`${to}T00:00:00Z`)
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
  const prevTo = new Date(fromDate)
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1))
  return { from: toYmd(prevFrom), to: toYmd(prevTo) }
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return 0
    return null // undefined growth — UI shows "—"
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

function dateRangeYmd(from: string, to: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    out.push(toYmd(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function nextDayIso(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import {
  materialsCostByDoctor,
  materialsCostByPlan,
  MATERIALS_PARTICULAR_KEY,
} from './materials-cost'
import { getTenantTimezone, ymdStartOfDayUtc, ymdNextDayStartUtc } from '@/lib/utils/tenant-tz'

/**
 * T139 — Agrega `appointments_effective` em receita-por-plano e
 * produção-por-médico para o período [from, to] (inclusivo). Ordenação
 * dos arrays por net desc pra dar um default útil à UI e aos exports.
 *
 * Tudo rodado em TS após um único SELECT pra (a) evitar RPC/função SQL
 * adicional e (b) permitir que PDF e Excel consumam exatamente o mesmo
 * DTO (garantia de paridade SC-006).
 *
 * Perf alvo: 5 000 atendimentos em < 30 s (SC-004). O round-trip do
 * Supabase domina; o reduce em memória é trivial.
 */
export interface MonthlyReportPeriod {
  from: string
  to: string
}

export interface RevenueByPlan {
  planId: string
  planName: string
  netRevenueCents: number
  appointmentCount: number
  /** Feature 045 — gasto com materiais atribuído a este convênio. */
  materialsCostCents: number
}

export interface ProductionByDoctor {
  doctorId: string
  doctorName: string
  netProductionCents: number
  netCommissionCents: number
  appointmentCount: number
  /** Feature 045 — gasto com materiais atribuído a este profissional. */
  materialsCostCents: number
}

export interface MonthlyTotals {
  netRevenueCents: number
  netCommissionCents: number
  appointmentCount: number
  reversalCount: number
  /** Feature 045 — gasto com materiais total do período (estornados excluídos). */
  materialsCostCents: number
}

export interface MonthlyReport {
  period: MonthlyReportPeriod
  revenueByPlan: RevenueByPlan[]
  productionByDoctor: ProductionByDoctor[]
  totals: MonthlyTotals
}

interface RowWithJoins {
  id: string
  plan_id: string
  doctor_id: string
  appointment_at: string
  net_amount_cents: number | null
  net_commission_cents: number | null
  effective_status: string | null
  health_plans: { name: string } | null
  doctors: { full_name: string } | null
}

export interface MonthlyReportInput {
  tenantId: string
  from: string
  to: string
}

export async function buildMonthlyReport(
  supabase: SupabaseClient<Database>,
  input: MonthlyReportInput,
): Promise<MonthlyReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    throw new ValidationError('Parâmetros from/to devem estar no formato YYYY-MM-DD')
  }
  if (input.from > input.to) {
    throw new ValidationError('Parâmetro `from` não pode ser posterior a `to`')
  }

  // Inclusive upper bound: use < next-day midnight to capture the whole day.
  // Boundaries resolved no fuso do tenant — agendamento à noite no último
  // dia do mês não escorre pro mês seguinte (Camada 3, T1).
  const tz = await getTenantTimezone(supabase, input.tenantId)
  const fromTs = ymdStartOfDayUtc(input.from, tz)
  const toExclusiveTs = ymdNextDayStartUtc(input.to, tz)

  // Feature 045 — gasto com materiais atribuído por convênio e por profissional
  // (mesma janela; estornados já excluídos pelo agregador).
  const [materialsByPlan, materialsByDoctor] = await Promise.all([
    materialsCostByPlan(supabase, { tenantId: input.tenantId, fromIso: fromTs, toIso: toExclusiveTs }),
    materialsCostByDoctor(supabase, {
      tenantId: input.tenantId,
      fromIso: fromTs,
      toIso: toExclusiveTs,
    }),
  ])
  let materialsTotalCents = 0
  for (const v of materialsByPlan.values()) materialsTotalCents += v

  // Paginate: PostgREST caps each response at `db-max-rows` (default 1000
  // locally; typically 1000 in Supabase cloud too). SC-004 expects the
  // aggregator to process up to 5 000 appointments per tenant-month, so
  // we loop with `.range()` until we see a short page.
  const PAGE_SIZE = 1000
  const rows: RowWithJoins[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select(
        'id, plan_id, doctor_id, appointment_at, net_amount_cents, net_commission_cents, effective_status, health_plans(name), doctors(full_name)',
      )
      .eq('tenant_id', input.tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusiveTs)
      .order('appointment_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`buildMonthlyReport query failed: ${error.message}`)
    const page = (data ?? []) as unknown as RowWithJoins[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const byPlan = new Map<string, RevenueByPlan>()
  const byDoctor = new Map<string, ProductionByDoctor>()
  let netRevenue = 0
  let netCommission = 0
  let reversalCount = 0

  for (const r of rows) {
    // Só atendimentos REALIZADOS ('ativo') entram na receita/produção. Cancelado
    // e estornado não são receita — a view zera o net só do estornado, então um
    // 'cancelado' sem estorno traria o valor cheio se não filtrássemos aqui.
    // (Mesmo critério de by-plan/by-professional/operating-result/repasse.)
    if (r.effective_status !== 'ativo') {
      if (r.effective_status === 'estornado') reversalCount += 1
      continue
    }
    const net = r.net_amount_cents ?? 0
    const netComm = r.net_commission_cents ?? 0
    netRevenue += net
    netCommission += netComm

    const plan = byPlan.get(r.plan_id) ?? {
      planId: r.plan_id,
      planName: r.health_plans?.name ?? '—',
      netRevenueCents: 0,
      appointmentCount: 0,
      materialsCostCents: 0,
    }
    plan.netRevenueCents += net
    plan.appointmentCount += 1
    byPlan.set(r.plan_id, plan)

    const doc = byDoctor.get(r.doctor_id) ?? {
      doctorId: r.doctor_id,
      doctorName: r.doctors?.full_name ?? '—',
      netProductionCents: 0,
      netCommissionCents: 0,
      appointmentCount: 0,
      materialsCostCents: 0,
    }
    doc.netProductionCents += net
    doc.netCommissionCents += netComm
    doc.appointmentCount += 1
    byDoctor.set(r.doctor_id, doc)
  }

  // Feature 045 — atribui o gasto com materiais a cada linha (particular do
  // agregador = MATERIALS_PARTICULAR_KEY; `|| KEY` cobre plan_id nulo/vazio).
  const revenueByPlan = Array.from(byPlan.values())
    .map((p) => ({
      ...p,
      materialsCostCents: materialsByPlan.get(p.planId || MATERIALS_PARTICULAR_KEY) ?? 0,
    }))
    .sort((a, b) => b.netRevenueCents - a.netRevenueCents)
  const productionByDoctor = Array.from(byDoctor.values())
    .map((d) => ({ ...d, materialsCostCents: materialsByDoctor.get(d.doctorId) ?? 0 }))
    .sort((a, b) => b.netProductionCents - a.netProductionCents)

  return {
    period: { from: input.from, to: input.to },
    revenueByPlan,
    productionByDoctor,
    totals: {
      netRevenueCents: netRevenue,
      netCommissionCents: netCommission,
      appointmentCount: rows.length,
      reversalCount,
      materialsCostCents: materialsTotalCents,
    },
  }
}

/**
 * Serializa o DTO em snake_case para manter paridade exata com a
 * resposta documentada em `contracts/relatorios.yaml`.
 */
export function monthlyReportToWire(report: MonthlyReport): {
  period: { from: string; to: string }
  revenue_by_plan: Array<{
    plan_id: string
    plan_name: string
    net_revenue_cents: number
    appointment_count: number
    materials_cost_cents: number
  }>
  production_by_doctor: Array<{
    doctor_id: string
    doctor_name: string
    net_production_cents: number
    net_commission_cents: number
    appointment_count: number
    materials_cost_cents: number
  }>
  totals: {
    net_revenue_cents: number
    net_commission_cents: number
    appointment_count: number
    reversal_count: number
    materials_cost_cents: number
  }
} {
  return {
    period: report.period,
    revenue_by_plan: report.revenueByPlan.map((r) => ({
      plan_id: r.planId,
      plan_name: r.planName,
      net_revenue_cents: r.netRevenueCents,
      appointment_count: r.appointmentCount,
      materials_cost_cents: r.materialsCostCents,
    })),
    production_by_doctor: report.productionByDoctor.map((d) => ({
      doctor_id: d.doctorId,
      doctor_name: d.doctorName,
      net_production_cents: d.netProductionCents,
      net_commission_cents: d.netCommissionCents,
      appointment_count: d.appointmentCount,
      materials_cost_cents: d.materialsCostCents,
    })),
    totals: {
      net_revenue_cents: report.totals.netRevenueCents,
      net_commission_cents: report.totals.netCommissionCents,
      appointment_count: report.totals.appointmentCount,
      reversal_count: report.totals.reversalCount,
      materials_cost_cents: report.totals.materialsCostCents,
    },
  }
}

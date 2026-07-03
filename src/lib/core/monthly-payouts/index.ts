import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { selectMonthlyFixedPayLines } from '@/lib/core/reports/monthly-fixed-pay-lines'

export type MonthlyPayoutStatus = 'aberto' | 'fechado' | 'pago'

export interface PayoutPlanRevenue {
  planId: string
  planName: string
  grossRevenueCents: number
  commissionCents: number
  appointmentCount: number
}

export interface MonthlyPayoutLine {
  id: string | null
  doctorId: string
  doctorName: string
  grossRevenueCents: number
  commissionCents: number
  fixedPaymentCents: number
  liberalPaymentCents: number
  adjustmentsCents: number
  totalDueCents: number
  /**
   * Origem da receita/comissão do médico por convênio. Populado no mês ABERTO
   * (cálculo ao vivo, soma exata). No mês FECHADO fica vazio — o snapshot
   * congelado não guarda a quebra; use o relatório Médico × convênio para o
   * histórico.
   */
  revenueByPlan: PayoutPlanRevenue[]
  closedAt: string | null
  paidAt: string | null
  paidAmountCents: number | null
  paymentMethod: string | null
  paymentNote: string | null
  status: MonthlyPayoutStatus
}

export interface MonthlyPayoutSnapshot {
  month: string
  isClosed: boolean
  closedAt: string | null
  payouts: MonthlyPayoutLine[]
  totalDueCents: number
  canReopen: boolean
  canReopenReason: string | null
}

interface PayoutDb {
  id: string
  doctor_id: string
  doctors: { full_name: string } | null
  gross_revenue_cents: number
  commission_cents: number
  fixed_payment_cents: number
  liberal_payment_cents: number
  adjustments_cents: number
  total_due_cents: number
  closed_at: string | null
  paid_at: string | null
  paid_amount_cents: number | null
  payment_method: string | null
  payment_note: string | null
}

/**
 * Carrega snapshot do mês. Se já fechado, lê da tabela monthly_payouts.
 * Se aberto, calcula ao vivo via appointments_effective agrupado por médico.
 * Para o teste de paridade SC-006: ambos os caminhos retornam o mesmo
 * shape; quando fechado, valores estão congelados; quando aberto, refletem
 * a realidade atual.
 */
export async function getMonthlyPayoutSnapshot(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; month: string; restrictDoctorId?: string | null },
): Promise<MonthlyPayoutSnapshot> {
  // 1. Verifica se está fechado
  let q = supabase
    .from('monthly_payouts' as never)
    .select(
      'id, doctor_id, doctors!inner(full_name), gross_revenue_cents, commission_cents, fixed_payment_cents, liberal_payment_cents, adjustments_cents, total_due_cents, closed_at, paid_at, paid_amount_cents, payment_method, payment_note',
    )
    .eq('tenant_id', args.tenantId)
    .eq('month', args.month)
  if (args.restrictDoctorId) q = q.eq('doctor_id', args.restrictDoctorId)

  const closedRes = await q
  if (closedRes.error) throw new Error(`load payouts: ${closedRes.error.message}`)
  const closedRows = (closedRes.data ?? []) as unknown as PayoutDb[]

  if (closedRows.length > 0 && closedRows[0]!.closed_at !== null) {
    // Fechado — usar snapshot
    const lines: MonthlyPayoutLine[] = closedRows.map((r) => ({
      id: r.id,
      doctorId: r.doctor_id,
      doctorName: r.doctors?.full_name ?? '—',
      grossRevenueCents: Number(r.gross_revenue_cents),
      commissionCents: Number(r.commission_cents),
      fixedPaymentCents: Number(r.fixed_payment_cents),
      liberalPaymentCents: Number(r.liberal_payment_cents),
      adjustmentsCents: Number(r.adjustments_cents),
      totalDueCents: Number(r.total_due_cents),
      revenueByPlan: [],
      closedAt: r.closed_at,
      paidAt: r.paid_at,
      paidAmountCents: r.paid_amount_cents !== null ? Number(r.paid_amount_cents) : null,
      paymentMethod: r.payment_method,
      paymentNote: r.payment_note,
      status: r.paid_at ? 'pago' : 'fechado',
    }))
    const anyPaid = lines.some((l) => l.paidAt !== null)
    const within24h =
      lines.length > 0 && lines[0]!.closedAt
        ? Date.now() - new Date(lines[0]!.closedAt!).getTime() <= 24 * 3600 * 1000
        : false
    return {
      month: args.month,
      isClosed: true,
      closedAt: lines[0]?.closedAt ?? null,
      payouts: lines,
      totalDueCents: lines.reduce((s, l) => s + l.totalDueCents, 0),
      canReopen: !anyPaid && within24h,
      canReopenReason: anyPaid
        ? 'Existem repasses já marcados como pagos'
        : !within24h
          ? 'Janela de 24h expirou'
          : null,
    }
  }

  // 2. Aberto — calcular ao vivo
  return computeOpenMonthSnapshot(supabase, args)
}

async function computeOpenMonthSnapshot(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; month: string; restrictDoctorId?: string | null },
): Promise<MonthlyPayoutSnapshot> {
  // Calcula boundaries do mês no fuso UTC (simplificação)
  const [year, mon] = args.month.split('-').map(Number)
  if (!year || !mon) throw new ValidationError('invalid month format')
  const fromIso = `${args.month}-01T00:00:00Z`
  const toMonth = mon === 12 ? 1 : mon + 1
  const toYear = mon === 12 ? year + 1 : year
  const toIso = `${toYear}-${String(toMonth).padStart(2, '0')}-01T00:00:00Z`

  // Médicos ativos
  let dq = supabase
    .from('doctors')
    .select('id, full_name')
    .eq('tenant_id', args.tenantId)
    .eq('active', true)
  if (args.restrictDoctorId) dq = dq.eq('id', args.restrictDoctorId)
  const docsRes = await dq
  if (docsRes.error) throw new Error(`doctors: ${docsRes.error.message}`)
  const doctors = (docsRes.data ?? []) as Array<{ id: string; full_name: string }>

  // Atendimentos do mês (status ativo)
  const apptRes = await supabase
    .from('appointments_effective' as never)
    .select(
      'doctor_id, plan_id, frozen_amount_cents, net_commission_cents, effective_status, appointment_at',
    )
    .eq('tenant_id', args.tenantId)
    .eq('effective_status', 'ativo')
    .gte('appointment_at', fromIso)
    .lt('appointment_at', toIso)
  if (apptRes.error) throw new Error(`appointments: ${apptRes.error.message}`)

  const apptAgg = new Map<string, { gross: number; commission: number }>()
  // Quebra por médico×plano (chave doctorId|planId). Cada atendimento tem um
  // único plano, então a soma das células bate com o agregado por médico.
  const planAgg = new Map<
    string,
    { planId: string; gross: number; commission: number; count: number }
  >()
  const doctorPlanKeys = new Map<string, Set<string>>()
  for (const r of apptRes.data as unknown as Array<{
    doctor_id: string
    plan_id: string | null
    frozen_amount_cents: number
    net_commission_cents: number
  }>) {
    const cur = apptAgg.get(r.doctor_id) ?? { gross: 0, commission: 0 }
    cur.gross += Number(r.frozen_amount_cents ?? 0)
    cur.commission += Number(r.net_commission_cents ?? 0)
    apptAgg.set(r.doctor_id, cur)

    const planId = r.plan_id ?? ''
    const planKey = `${r.doctor_id}|${planId}`
    const pcur = planAgg.get(planKey) ?? { planId, gross: 0, commission: 0, count: 0 }
    pcur.gross += Number(r.frozen_amount_cents ?? 0)
    pcur.commission += Number(r.net_commission_cents ?? 0)
    pcur.count += 1
    planAgg.set(planKey, pcur)
    const set = doctorPlanKeys.get(r.doctor_id) ?? new Set<string>()
    set.add(planKey)
    doctorPlanKeys.set(r.doctor_id, set)
  }

  // Nomes dos convênios presentes (particular = '' → "Particular").
  const planIds = Array.from(
    new Set(
      Array.from(planAgg.values())
        .map((p) => p.planId)
        .filter((id) => id.length > 0),
    ),
  )
  const planNames = new Map<string, string>()
  if (planIds.length > 0) {
    const plansRes = await supabase
      .from('health_plans')
      .select('id, name')
      .eq('tenant_id', args.tenantId)
      .in('id', planIds)
    if (plansRes.error) throw new Error(`health_plans: ${plansRes.error.message}`)
    for (const p of (plansRes.data ?? []) as Array<{ id: string; name: string }>) {
      planNames.set(p.id, p.name)
    }
  }
  const revenueByPlanFor = (doctorId: string): PayoutPlanRevenue[] => {
    const keys = doctorPlanKeys.get(doctorId)
    if (!keys) return []
    return Array.from(keys)
      .map((k) => {
        const p = planAgg.get(k)!
        return {
          planId: p.planId,
          planName: p.planId ? (planNames.get(p.planId) ?? 'Convênio') : 'Particular',
          grossRevenueCents: p.gross,
          commissionCents: p.commission,
          appointmentCount: p.count,
        }
      })
      .sort((a, b) => b.grossRevenueCents - a.grossRevenueCents)
  }

  // Ajustes a aplicar neste mês
  const adjRes = await supabase
    .from('monthly_payouts_adjustments' as never)
    .select('doctor_id, delta_cents')
    .eq('tenant_id', args.tenantId)
    .eq('applied_month', args.month)
  if (adjRes.error) throw new Error(`adjustments: ${adjRes.error.message}`)
  const adjAgg = new Map<string, number>()
  for (const r of adjRes.data as unknown as Array<{ doctor_id: string; delta_cents: number }>) {
    adjAgg.set(r.doctor_id, (adjAgg.get(r.doctor_id) ?? 0) + Number(r.delta_cents))
  }

  // Pagamento liberal (participações de assistente) por médico no mês,
  // excluindo atendimentos estornados. Atribui ao assistant_doctor_id —
  // antes o snapshot aberto zerava este campo (close_monthly_payout também
  // grava 0; ver caveat na migration de fechamento).
  const liberalAgg = await aggregateLiberalByDoctor(supabase, args.tenantId, fromIso, toIso)

  // Pagamento fixo por médico (modo 'fixo') via view virtual. Antes o
  // snapshot aberto zerava — agora bate com o que a migration 0126 grava
  // no fechamento.
  const fixedLines = await selectMonthlyFixedPayLines(supabase, {
    tenantId: args.tenantId,
    year,
    month: mon,
  })
  const fixedAgg = new Map<string, number>()
  for (const l of fixedLines) {
    fixedAgg.set(l.doctorId, (fixedAgg.get(l.doctorId) ?? 0) + l.amountCents)
  }

  const lines: MonthlyPayoutLine[] = doctors.map((d) => {
    const a = apptAgg.get(d.id) ?? { gross: 0, commission: 0 }
    const adj = adjAgg.get(d.id) ?? 0
    const liberal = liberalAgg.get(d.id) ?? 0
    const fixed = fixedAgg.get(d.id) ?? 0
    return {
      id: null,
      doctorId: d.id,
      doctorName: d.full_name,
      grossRevenueCents: a.gross,
      commissionCents: a.commission,
      fixedPaymentCents: fixed,
      liberalPaymentCents: liberal,
      adjustmentsCents: adj,
      totalDueCents: a.commission + fixed + liberal + adj,
      revenueByPlan: revenueByPlanFor(d.id),
      closedAt: null,
      paidAt: null,
      paidAmountCents: null,
      paymentMethod: null,
      paymentNote: null,
      status: 'aberto',
    }
  })

  return {
    month: args.month,
    isClosed: false,
    closedAt: null,
    payouts: lines,
    totalDueCents: lines.reduce((s, l) => s + l.totalDueCents, 0),
    canReopen: false,
    canReopenReason: null,
  }
}

/**
 * Soma o pagamento liberal (participações de assistente ativas) por médico
 * dentro do intervalo [fromIso, toIso), excluindo atendimentos estornados.
 * Chave do mapa = assistant_doctor_id.
 */
async function aggregateLiberalByDoctor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const { data, error } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'assistant_doctor_id, frozen_amount_cents, appointment_id, appointment:appointment_id ( appointment_at )',
    )
    .eq('tenant_id', tenantId)
    .is('removed_at', null)
  if (error) {
    // best-effort — se a migration de assistentes não aplicou, considera 0.
    return out
  }
  const rows = (data ?? []) as unknown as Array<{
    assistant_doctor_id: string
    frozen_amount_cents: number
    appointment_id: string
    appointment: { appointment_at: string | null } | null
  }>
  const fromMs = new Date(fromIso).getTime()
  const toMs = new Date(toIso).getTime()
  const inMonth = rows.filter((r) => {
    const at = r.appointment?.appointment_at
    if (!at) return false
    const t = new Date(at).getTime()
    return t >= fromMs && t < toMs
  })
  if (inMonth.length === 0) return out

  const apptIds = Array.from(new Set(inMonth.map((r) => r.appointment_id)))
  const { data: reversalsRaw } = await supabase
    .from('appointment_reversals')
    .select('appointment_id')
    .in('appointment_id', apptIds)
  const reversedSet = new Set(
    ((reversalsRaw ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
  )

  for (const r of inMonth) {
    if (reversedSet.has(r.appointment_id)) continue
    out.set(
      r.assistant_doctor_id,
      (out.get(r.assistant_doctor_id) ?? 0) + Number(r.frozen_amount_cents ?? 0),
    )
  }
  return out
}

export async function closeMonthlyPayout(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; month: string },
): Promise<{ payoutsCount: number; totalValueCents: number; closedAt: string }> {
  const res = await supabase.rpc(
    'close_monthly_payout' as never,
    {
      p_tenant_id: args.tenantId,
      p_month: args.month,
    } as never,
  )
  if (res.error) throw new Error(`close month: ${res.error.message}`)
  const d = res.data as {
    payouts_count?: number
    total_value_cents?: number
    closed_at?: string
  }
  return {
    payoutsCount: d?.payouts_count ?? 0,
    totalValueCents: d?.total_value_cents ?? 0,
    closedAt: d?.closed_at ?? new Date().toISOString(),
  }
}

export async function reopenMonthlyPayout(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; month: string; reason: string },
): Promise<{ snapshotId: string; reopenedAt: string }> {
  if (args.reason.trim().length < 20) {
    throw new ValidationError('reason must be at least 20 characters')
  }
  const res = await supabase.rpc(
    'reopen_monthly_payout' as never,
    {
      p_tenant_id: args.tenantId,
      p_month: args.month,
      p_reason: args.reason,
    } as never,
  )
  if (res.error) throw new Error(`reopen month: ${res.error.message}`)
  const d = res.data as { snapshot_id?: string; reopened_at?: string }
  return {
    snapshotId: d?.snapshot_id ?? '',
    reopenedAt: d?.reopened_at ?? new Date().toISOString(),
  }
}

export async function markPayoutPaid(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    payoutId: string
    paidAt: string
    paidAmountCents: number
    paymentMethod: string
    paymentNote?: string | null
    actorUserId: string
  },
): Promise<void> {
  const upd = await supabase
    .from('monthly_payouts' as never)
    .update({
      paid_at: args.paidAt,
      paid_amount_cents: args.paidAmountCents,
      payment_method: args.paymentMethod,
      payment_note: args.paymentNote ?? null,
    } as never)
    .eq('id', args.payoutId)
    .eq('tenant_id', args.tenantId)
  if (upd.error) throw new Error(`mark payout paid: ${upd.error.message}`)
  await supabase.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: args.tenantId,
      p_entity: 'monthly_payouts',
      p_entity_id: args.payoutId,
      p_field: 'paid_at',
      p_old: null,
      p_new: args.paidAt,
      p_reason: `paid_amount=${args.paidAmountCents};method=${args.paymentMethod}`,
    } as never,
  )
}

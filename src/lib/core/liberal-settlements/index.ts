import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { summaryByProfessional } from '@/lib/core/reports/by-professional'

export interface LiberalDoctorTotal {
  doctorId: string
  doctorName: string
  /** Comissão dos atendimentos onde é o executante, no período. */
  commissionCents: number
  /** Honorários de participação (appointment_assistants) no período. */
  participationCents: number
  /** commissionCents + participationCents. */
  totalCents: number
  /** Já quitado neste período exato (de/até) — soma das quitações registradas. */
  paidCents: number
}

export interface LiberalSettlementRow {
  id: string
  doctorId: string
  doctorName: string
  periodFrom: string
  periodTo: string
  amountCents: number
  note: string | null
  paidAt: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dayRange(from: string, to: string): { fromMs: number; toExclusiveMs: number } {
  const fromMs = new Date(`${from}T00:00:00`).getTime()
  const toStart = new Date(`${to}T00:00:00`).getTime()
  return { fromMs, toExclusiveMs: toStart + 24 * 60 * 60 * 1000 }
}

/** Soma os honorários de participação por médico no período. */
async function aggregateParticipations(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const { data, error } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'assistant_doctor_id, frozen_amount_cents, appointment_id, appointment:appointment_id ( appointment_at )',
    )
    .eq('tenant_id', tenantId)
    .is('removed_at', null)
  if (error) return out
  const rows = (data ?? []) as unknown as Array<{
    assistant_doctor_id: string
    frozen_amount_cents: number
    appointment_id: string
    appointment: { appointment_at: string | null } | null
  }>
  const { fromMs, toExclusiveMs } = dayRange(from, to)
  const inRange = rows.filter((r) => {
    const at = r.appointment?.appointment_at
    if (!at) return false
    const t = new Date(at).getTime()
    return t >= fromMs && t < toExclusiveMs
  })
  if (inRange.length === 0) return out
  const apptIds = Array.from(new Set(inRange.map((r) => r.appointment_id)))
  const { data: reversalsRaw } = await supabase
    .from('appointment_reversals')
    .select('appointment_id')
    .in('appointment_id', apptIds)
  const reversed = new Set(
    ((reversalsRaw ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
  )
  for (const r of inRange) {
    if (reversed.has(r.appointment_id)) continue
    out.set(
      r.assistant_doctor_id,
      (out.get(r.assistant_doctor_id) ?? 0) + Number(r.frozen_amount_cents ?? 0),
    )
  }
  return out
}

/**
 * Totais a pagar de profissionais LIBERAIS no período [from, to]: comissão dos
 * atendimentos onde é o executante + honorários de participação. Junta o que já
 * foi quitado exatamente nesse período. Só profissionais com payment_mode
 * 'liberal' (mais quem teve participação no período).
 */
export async function aggregateLiberalByPeriod(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; from: string; to: string },
): Promise<LiberalDoctorTotal[]> {
  if (!DATE_RE.test(args.from) || !DATE_RE.test(args.to)) {
    throw new ValidationError('Datas inválidas (use AAAA-MM-DD).')
  }
  if (args.from > args.to) throw new ValidationError('Data inicial maior que a final.')

  // Profissionais liberais ativos.
  const { data: docsRaw } = await supabase
    .from('doctors')
    .select('id, full_name, payment_mode, active')
    .eq('tenant_id', args.tenantId)
  const docs = (docsRaw ?? []) as Array<{
    id: string
    full_name: string | null
    payment_mode: string | null
    active: boolean | null
  }>
  const nameById = new Map(docs.map((d) => [d.id, d.full_name ?? '—']))
  const liberalIds = new Set(
    docs.filter((d) => d.payment_mode === 'liberal' && d.active !== false).map((d) => d.id),
  )

  // Comissão por médico no período (executante) + participações.
  const [summary, participations] = await Promise.all([
    summaryByProfessional(supabase, {
      tenantId: args.tenantId,
      from: args.from,
      to: args.to,
    }).catch(() => []),
    aggregateParticipations(supabase, args.tenantId, args.from, args.to),
  ])
  const commissionById = new Map(summary.map((s) => [s.doctorId, s.totalCommissionCents]))

  // Quitações já registradas para EXATAMENTE este período.
  const { data: paidRaw } = await supabase
    .from('liberal_payment_settlements' as never)
    .select('doctor_id, amount_cents')
    .eq('tenant_id', args.tenantId)
    .eq('period_from', args.from)
    .eq('period_to', args.to)
  const paidById = new Map<string, number>()
  for (const p of (paidRaw ?? []) as unknown as Array<{
    doctor_id: string
    amount_cents: number
  }>) {
    paidById.set(p.doctor_id, (paidById.get(p.doctor_id) ?? 0) + Number(p.amount_cents ?? 0))
  }

  // Inclui liberais + quem teve participação no período.
  const ids = new Set<string>([...liberalIds, ...participations.keys()])

  return (
    Array.from(ids)
      .map((id) => {
        const isLiberal = liberalIds.has(id)
        // Comissão do executante só conta para liberais (comissionado/fixo é pago
        // no repasse mensal). Participação conta para todos.
        const commission = isLiberal ? (commissionById.get(id) ?? 0) : 0
        const participation = participations.get(id) ?? 0
        return {
          doctorId: id,
          doctorName: nameById.get(id) ?? '—',
          commissionCents: commission,
          participationCents: participation,
          totalCents: commission + participation,
          paidCents: paidById.get(id) ?? 0,
        }
      })
      // Todo liberal aparece (mesmo R$ 0 — pode receber valor manual);
      // não-liberais só se tiveram participação/pagamento no período.
      .filter((r) => liberalIds.has(r.doctorId) || r.totalCents > 0 || r.paidCents > 0)
      .sort((a, b) => a.doctorName.localeCompare(b.doctorName))
  )
}

/** Registra uma quitação de honorários de um profissional para um período. */
export async function recordLiberalSettlement(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    doctorId: string
    from: string
    to: string
    amountCents: number
    note?: string | null
    actorUserId: string
  },
): Promise<{ id: string }> {
  if (!DATE_RE.test(args.from) || !DATE_RE.test(args.to)) {
    throw new ValidationError('Datas inválidas.')
  }
  if (args.from > args.to) throw new ValidationError('Data inicial maior que a final.')
  if (!Number.isFinite(args.amountCents) || args.amountCents < 0) {
    throw new ValidationError('Valor inválido.')
  }

  const { data, error } = await supabase
    .from('liberal_payment_settlements' as never)
    .insert({
      tenant_id: args.tenantId,
      doctor_id: args.doctorId,
      period_from: args.from,
      period_to: args.to,
      amount_cents: args.amountCents,
      note: args.note?.trim() || null,
      paid_by: args.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`recordLiberalSettlement failed: ${error.message}`)

  await supabase.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorUserId,
    actor_label: null,
    entity: 'liberal_payment_settlements',
    entity_id: (data as { id: string }).id,
    field: 'paid',
    old_value: null,
    new_value: String(args.amountCents),
    reason: `quitação liberal ${args.from}..${args.to}`,
    result: 'success',
  } as never)

  return { id: (data as { id: string }).id }
}

/** Lista as quitações registradas (mais recentes primeiro). */
export async function listLiberalSettlements(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; limit?: number },
): Promise<LiberalSettlementRow[]> {
  const { data, error } = await supabase
    .from('liberal_payment_settlements' as never)
    .select('id, doctor_id, period_from, period_to, amount_cents, note, paid_at')
    .eq('tenant_id', args.tenantId)
    .order('paid_at', { ascending: false })
    .limit(Math.min(Math.max(args.limit ?? 50, 1), 200))
  if (error) return []
  const rows = (data ?? []) as unknown as Array<{
    id: string
    doctor_id: string
    period_from: string
    period_to: string
    amount_cents: number
    note: string | null
    paid_at: string
  }>
  const doctorIds = Array.from(new Set(rows.map((r) => r.doctor_id)))
  const { data: docsRaw } = await supabase
    .from('doctors')
    .select('id, full_name')
    .in('id', doctorIds.length > 0 ? doctorIds : ['00000000-0000-0000-0000-000000000000'])
  const nameById = new Map(
    ((docsRaw ?? []) as Array<{ id: string; full_name: string | null }>).map((d) => [
      d.id,
      d.full_name ?? '—',
    ]),
  )
  return rows.map((r) => ({
    id: r.id,
    doctorId: r.doctor_id,
    doctorName: nameById.get(r.doctor_id) ?? '—',
    periodFrom: r.period_from,
    periodTo: r.period_to,
    amountCents: r.amount_cents,
    note: r.note,
    paidAt: r.paid_at,
  }))
}

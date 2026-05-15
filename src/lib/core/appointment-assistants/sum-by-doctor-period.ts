import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface AssistantParticipation {
  id: string
  appointmentId: string
  appointmentAt: string
  patientName: string | null
  frozenAmountCents: number
}

export interface SumByDoctorPeriodResult {
  doctorId: string
  participationsCount: number
  totalPaidCents: number
  participations: AssistantParticipation[]
}

/**
 * Soma e detalha as participações ATIVAS (removed_at IS NULL) do doctor
 * Liberal num período, EXCLUINDO atendimentos estornados (FR-019).
 *
 * Usado pelo relatório por profissional Liberal (US3) e por agregações
 * do resultado operacional.
 */
export async function sumLiberalParticipationsByPeriod(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    doctorId: string
    from: string // ISO timestamp ou YYYY-MM-DD
    to: string // ISO timestamp ou YYYY-MM-DD
  },
): Promise<SumByDoctorPeriodResult> {
  // Embed do appointment com filtro por appointment_at no período + exclui
  // estornados via subquery em appointment_reversals.
  const { data, error } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'id, appointment_id, frozen_amount_cents, appointment:appointment_id ( id, appointment_at, patient_id, patients:patient_id ( id ) )',
    )
    .eq('tenant_id', args.tenantId)
    .eq('assistant_doctor_id', args.doctorId)
    .is('removed_at', null)

  if (error) {
    throw new Error(`sumLiberalParticipationsByPeriod failed: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    appointment_id: string
    frozen_amount_cents: number
    appointment: { id: string; appointment_at: string; patient_id: string } | null
  }>

  // Filtra por período no JS (a query SQL não suporta filtro em coluna do
  // embed sem RPC dedicada). Para tenants pequenos é OK.
  const fromT = new Date(args.from).getTime()
  const toT = new Date(args.to).getTime()
  const inPeriod = rows.filter((r) => {
    if (!r.appointment?.appointment_at) return false
    const t = new Date(r.appointment.appointment_at).getTime()
    return t >= fromT && t <= toT
  })

  if (inPeriod.length === 0) {
    return {
      doctorId: args.doctorId,
      participationsCount: 0,
      totalPaidCents: 0,
      participations: [],
    }
  }

  // Carrega reversals para os appointment_ids relevantes em uma query.
  const apptIds = Array.from(new Set(inPeriod.map((r) => r.appointment_id)))
  const { data: reversalsRaw } = await supabase
    .from('appointment_reversals')
    .select('appointment_id')
    .in('appointment_id', apptIds)
  const reversedSet = new Set(
    ((reversalsRaw ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
  )

  const participations: AssistantParticipation[] = []
  for (const r of inPeriod) {
    if (reversedSet.has(r.appointment_id)) continue
    participations.push({
      id: r.id,
      appointmentId: r.appointment_id,
      appointmentAt: r.appointment?.appointment_at ?? '',
      patientName: null, // PII descriptografada via RPC noutro caminho — preencher em camada superior se precisar.
      frozenAmountCents: r.frozen_amount_cents,
    })
  }
  const totalPaidCents = participations.reduce((s, p) => s + p.frozenAmountCents, 0)
  return {
    doctorId: args.doctorId,
    participationsCount: participations.length,
    totalPaidCents,
    participations,
  }
}

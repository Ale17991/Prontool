import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listParticipationDegrees } from '@/lib/core/tiss/domains'

export interface ProcedureParticipant {
  participantId: string
  procedureId: string
  doctorId: string
  doctorName: string
  participationDegree: string | null
  degreeLabel: string | null
  amountCents: number
  createdAt: string
}

/**
 * Feature 031 — lista participantes ATIVOS de um atendimento que estão
 * vinculados a uma LINHA DE PROCEDIMENTO (procedure_id NOT NULL), com o
 * rótulo do grau resolvido do domínio TISS 35. O consumidor agrupa por
 * `procedureId` (ver `groupParticipantsByProcedure`).
 *
 * Registros legados sem `procedure_id` (participação a nível de atendimento)
 * continuam a ser listados pelo caminho antigo (`listAssistantsByAppointment`).
 */
export async function listParticipantsByProcedure(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; appointmentId: string },
): Promise<ProcedureParticipant[]> {
  const { data, error } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'id, procedure_id, assistant_doctor_id, participation_degree, frozen_amount_cents, created_at, doctor:assistant_doctor_id ( full_name )',
    )
    .eq('tenant_id', args.tenantId)
    .eq('appointment_id', args.appointmentId)
    .is('removed_at', null)
    .not('procedure_id', 'is', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listParticipantsByProcedure failed: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    procedure_id: string
    assistant_doctor_id: string
    participation_degree: string | null
    frozen_amount_cents: number
    created_at: string
    doctor: { full_name: string } | null
  }>

  // Resolve rótulos do grau (dom. 35) numa única leitura.
  const degrees = await listParticipationDegrees(supabase).catch(() => [])
  const labelByCode = new Map(degrees.map((d) => [d.code, d.description]))

  return rows.map((r) => ({
    participantId: r.id,
    procedureId: r.procedure_id,
    doctorId: r.assistant_doctor_id,
    doctorName: r.doctor?.full_name ?? '(profissional removido)',
    participationDegree: r.participation_degree,
    degreeLabel: r.participation_degree
      ? (labelByCode.get(r.participation_degree) ?? null)
      : null,
    amountCents: r.frozen_amount_cents,
    createdAt: r.created_at,
  }))
}

/** Agrupa o resultado plano por `procedureId` para render por linha. */
export function groupParticipantsByProcedure(
  participants: ProcedureParticipant[],
): Map<string, ProcedureParticipant[]> {
  const byProc = new Map<string, ProcedureParticipant[]>()
  for (const p of participants) {
    const list = byProc.get(p.procedureId) ?? []
    list.push(p)
    byProc.set(p.procedureId, list)
  }
  return byProc
}

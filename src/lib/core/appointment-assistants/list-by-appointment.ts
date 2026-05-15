import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface ListedAssistant {
  id: string
  appointmentId: string
  assistantDoctorId: string
  doctorName: string
  doctorRole: string | null
  doctorSpecialty: string | null
  frozenAmountCents: number
  createdAt: string
  removedAt: string | null
}

export interface ListAssistantsResult {
  active: ListedAssistant[]
  removedCount: number
}

/**
 * Lista assistentes ATIVOS de um atendimento (removed_at IS NULL) +
 * contagem dos removidos historicos (para mostrar audit visual no detail).
 */
export async function listAssistantsByAppointment(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; appointmentId: string },
): Promise<ListAssistantsResult> {
  const { data, error } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'id, appointment_id, assistant_doctor_id, frozen_amount_cents, created_at, removed_at, doctor:assistant_doctor_id ( full_name, role, specialty )',
    )
    .eq('tenant_id', args.tenantId)
    .eq('appointment_id', args.appointmentId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`listAssistantsByAppointment failed: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    appointment_id: string
    assistant_doctor_id: string
    frozen_amount_cents: number
    created_at: string
    removed_at: string | null
    doctor: { full_name: string; role: string | null; specialty: string | null } | null
  }>

  const active: ListedAssistant[] = []
  let removedCount = 0
  for (const r of rows) {
    if (r.removed_at) {
      removedCount += 1
      continue
    }
    active.push({
      id: r.id,
      appointmentId: r.appointment_id,
      assistantDoctorId: r.assistant_doctor_id,
      doctorName: r.doctor?.full_name ?? '(profissional removido)',
      doctorRole: r.doctor?.role ?? null,
      doctorSpecialty: r.doctor?.specialty ?? null,
      frozenAmountCents: r.frozen_amount_cents,
      createdAt: r.created_at,
      removedAt: null,
    })
  }
  return { active, removedCount }
}

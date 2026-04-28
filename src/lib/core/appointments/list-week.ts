import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DEFAULT_DURATION_MINUTES } from '@/lib/utils/calendar'

/**
 * Carrega atendimentos para a janela [weekStart, weekEnd] de um tenant,
 * usado pela visualizacao Calendario (feature 004 / US1).
 *
 * - Le `appointments_effective` (RLS por tenant ja em vigor).
 * - Faz join com `doctors` e `procedures` em uma unica query.
 * - Descriptografa nomes de paciente em batch via RPC.
 * - Aplica COALESCE para `duration_minutes` -> 30 (default na leitura, nao no banco).
 */
export interface ListWeekInput {
  tenantId: string
  weekStart: Date
  weekEnd: Date
  doctorIds?: string[]
}

export interface AppointmentWeekRow {
  id: string
  patientId: string
  patientName: string
  doctorId: string
  doctorName: string
  procedureId: string
  procedureLabel: string
  appointmentAt: string
  durationMinutes: number
  effectiveStatus: 'ativo' | 'estornado'
}

interface RawRow {
  id: string | null
  patient_id: string | null
  doctor_id: string | null
  procedure_id: string | null
  appointment_at: string | null
  duration_minutes: number | null
  effective_status: string | null
  doctors: { full_name: string | null } | null
  procedures: { tuss_code: string | null; display_name: string | null } | null
}

export async function listAppointmentsForWeek(
  supabase: SupabaseClient<Database>,
  input: ListWeekInput,
  options?: {
    /** Service-role client para descriptografar nomes; opcional. */
    serviceClient?: SupabaseClient<Database>
    /** Chave de descriptografia. Se ausente, retorna patientName='—'. */
    encryptionKey?: string
  },
): Promise<AppointmentWeekRow[]> {
  let query = supabase
    .from('appointments_effective')
    .select(
      'id, patient_id, doctor_id, procedure_id, appointment_at, duration_minutes, effective_status, ' +
        'doctors:doctor_id(full_name), ' +
        'procedures:procedure_id(tuss_code, display_name)',
    )
    .eq('tenant_id', input.tenantId)
    .gte('appointment_at', input.weekStart.toISOString())
    .lte('appointment_at', input.weekEnd.toISOString())
    .order('appointment_at', { ascending: true })
    .limit(500)

  if (input.doctorIds && input.doctorIds.length > 0) {
    query = query.in('doctor_id', input.doctorIds)
  }

  const { data, error } = await query
  if (error) throw new Error(`appointments week fetch failed: ${error.message}`)
  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []

  // Descriptografia de nomes em batch (mesmo padrao da pagina Lista).
  const patientNames = new Map<string, string>()
  const patientIds = Array.from(
    new Set(rows.map((r) => r.patient_id).filter((id): id is string => Boolean(id))),
  )
  if (options?.serviceClient && options?.encryptionKey && patientIds.length > 0) {
    const rpc = await options.serviceClient.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: input.tenantId,
      p_patient_ids: patientIds,
      p_key: options.encryptionKey,
    })
    type DecryptRow = { id: string; full_name: string | null; anonymized_at: string | null }
    for (const p of (rpc.data ?? []) as DecryptRow[]) {
      patientNames.set(p.id, p.anonymized_at ? '[anonimizado]' : p.full_name ?? '—')
    }
  }

  return rows
    .filter((r) => r.id && r.appointment_at && r.doctor_id && r.procedure_id && r.patient_id)
    .map<AppointmentWeekRow>((r) => ({
      id: r.id as string,
      patientId: r.patient_id as string,
      patientName: patientNames.get(r.patient_id as string) ?? '—',
      doctorId: r.doctor_id as string,
      doctorName: r.doctors?.full_name ?? '—',
      procedureId: r.procedure_id as string,
      procedureLabel:
        r.procedures?.display_name?.trim() || r.procedures?.tuss_code || '—',
      appointmentAt: r.appointment_at as string,
      durationMinutes: r.duration_minutes ?? DEFAULT_DURATION_MINUTES,
      effectiveStatus: (r.effective_status === 'estornado' ? 'estornado' : 'ativo'),
    }))
}

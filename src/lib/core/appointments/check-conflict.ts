import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Helper de pre-check de conflito de horario por profissional.
 *
 * Le `appointment_slot_locks` (que e mantido sincronizado por triggers
 * em appointments + appointment_reversals). Estornados nao tem entrada
 * em slot_locks — naturalmente excluidos do conflito.
 *
 * Usado:
 *   1. Pelo endpoint /api/atendimentos/check-conflict (UX preventiva).
 *   2. Por createAppointmentManually para enriquecer mensagem de 23P01.
 *
 * O veto autoritativo continua sendo a EXCLUDE constraint no banco —
 * esta funcao apenas LEIA o estado para feedback ao usuario.
 */
export interface ConflictCheckInput {
  tenantId: string
  doctorId: string
  startAt: Date
  endAt: Date
  /** Para edicao de horario: ignora o proprio appointment. */
  excludeAppointmentId?: string
}

export interface ConflictHit {
  appointmentId: string
  patientId: string
  patientName: string
  procedureLabel: string
  startAt: string
  endAt: string
}

interface RawLockRow {
  appointment_id: string
  slot_range: string
  appointments: {
    id: string | null
    patient_id: string | null
    appointment_at: string | null
    duration_minutes: number | null
    procedures: { tuss_code: string | null; display_name: string | null } | null
  } | null
}

export async function checkConflict(
  supabase: SupabaseClient<Database>,
  input: ConflictCheckInput,
  options?: {
    serviceClient?: SupabaseClient<Database>
    encryptionKey?: string
  },
): Promise<ConflictHit | null> {
  // PostgREST nao expoe operador && em tstzrange via REST; usamos overlap por
  // conta propria via filtros temporais sobrepostos ([start, end) overlap):
  //   inicio_existente < end_novo  AND  fim_existente > start_novo
  // Para isso precisamos do appointment_at + duration_minutes do appointment.
  // Buscamos slots do mesmo (tenant, doctor) que possam sobrepor o intervalo
  // — filtro grosso com offset de seguranca de 24h (max duration realista) — e
  // refinamos no client.
  const startIso = input.startAt.toISOString()
  const endIso = input.endAt.toISOString()
  const lookbackStart = new Date(input.startAt.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const query = supabase
    .from('appointment_slot_locks')
    .select(
      'appointment_id, slot_range, ' +
        'appointments:appointment_id(id, patient_id, appointment_at, duration_minutes, ' +
        'procedures:procedure_id(tuss_code, display_name))',
    )
    .eq('tenant_id', input.tenantId)
    .eq('doctor_id', input.doctorId)
    // Filtro grosso: appointments cujo appointment_at esta numa janela larga
    // que pode sobrepor [start, end). Refinamos abaixo no JS.
    .gte('appointments.appointment_at', lookbackStart)
    .lte('appointments.appointment_at', endIso)

  const { data, error } = await query
  if (error) throw new Error(`checkConflict failed: ${error.message}`)

  const rows = (data ?? []) as unknown as RawLockRow[]
  const hit = rows
    .filter((r) => r.appointments && r.appointment_id !== input.excludeAppointmentId)
    .find((r) => {
      const apt = r.appointments!
      if (!apt.appointment_at) return false
      const aStart = new Date(apt.appointment_at).getTime()
      const aEnd = aStart + (apt.duration_minutes ?? 30) * 60_000
      const nStart = input.startAt.getTime()
      const nEnd = input.endAt.getTime()
      // semi-aberto [start, end): aStart < nEnd AND aEnd > nStart
      return aStart < nEnd && aEnd > nStart
    })

  if (!hit || !hit.appointments) return null

  const apt = hit.appointments
  const aStart = new Date(apt.appointment_at as string)
  const aEnd = new Date(aStart.getTime() + (apt.duration_minutes ?? 30) * 60_000)

  let patientName = '—'
  if (options?.serviceClient && options?.encryptionKey && apt.patient_id) {
    const rpc = await options.serviceClient.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: input.tenantId,
      p_patient_ids: [apt.patient_id],
      p_key: options.encryptionKey,
    })
    type DecryptRow = { id: string; full_name: string | null; anonymized_at: string | null }
    const dec = ((rpc.data ?? []) as DecryptRow[])[0]
    if (dec) patientName = dec.anonymized_at ? '[anonimizado]' : dec.full_name ?? '—'
  }

  const procedureLabel =
    apt.procedures?.display_name?.trim() || apt.procedures?.tuss_code || '—'

  return {
    appointmentId: hit.appointment_id,
    patientId: apt.patient_id ?? '',
    patientName,
    procedureLabel,
    startAt: aStart.toISOString(),
    endAt: aEnd.toISOString(),
  }
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime()
}

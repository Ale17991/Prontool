import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'

/**
 * Marca um atendimento agendado como realizado, criando uma row em
 * `appointment_completions` (append-only). A view appointments_effective
 * passa a retornar status 'ativo' para esse atendimento.
 *
 * Triggers laterais sincronizam a etapa do plano de tratamento vinculada,
 * se houver, marcando-a como concluida (sem loop, via pg_trigger_depth).
 */
export interface MarkRealizedInput {
  appointmentId: string
  actorUserId: string
  reason?: string
}

export interface MarkRealizedResult {
  completionId: string
}

export async function markAppointmentRealized(
  supabase: SupabaseClient<Database>,
  input: MarkRealizedInput,
): Promise<MarkRealizedResult> {
  const { data, error } = await supabase.rpc('mark_appointment_realized', {
    p_appointment_id: input.appointmentId,
    p_by: input.actorUserId,
    p_reason: input.reason ?? undefined,
  })

  if (error) {
    const msg = error.message ?? ''
    if (/APPOINTMENT_NOT_FOUND/i.test(msg)) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 'atendimento nao encontrado', {
        status: 404,
      })
    }
    if (/APPOINTMENT_REVERSED/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_REVERSED',
        'atendimento estornado nao pode ser marcado como realizado',
        { status: 409 },
      )
    }
    if (/duplicate key|unique/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_ALREADY_REALIZED',
        'atendimento ja foi marcado como realizado',
        { status: 409 },
      )
    }
    throw new Error(`markAppointmentRealized failed: ${msg}`)
  }

  if (!data) {
    throw new Error('markAppointmentRealized: empty response')
  }

  return { completionId: data as string }
}

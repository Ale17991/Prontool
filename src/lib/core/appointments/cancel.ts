import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'

export type CancellationReason =
  | 'no_show'
  | 'paciente_desmarcou'
  | 'clinica_desmarcou'
  | 'estornado'
  | 'outro'

/**
 * Cancela um atendimento agendado/confirmado. Cria row em
 * `appointment_cancellations` (append-only). A view appointments_effective
 * passa a retornar status 'cancelado'. O slot lock e liberado pelo trigger
 * release_slot_lock_on_cancellation (permite reagendar no mesmo horario).
 *
 * Diferente do estorno (appointment_reversals), o cancelamento nao gera
 * impacto financeiro automatico — e' uma desmarcacao pre-atendimento.
 */
export interface CancelAppointmentInput {
  appointmentId: string
  actorUserId: string
  reason: CancellationReason
  notes?: string
}

export interface CancelAppointmentResult {
  cancellationId: string
}

export async function cancelAppointment(
  supabase: SupabaseClient<Database>,
  input: CancelAppointmentInput,
): Promise<CancelAppointmentResult> {
  // 'cancel_appointment' criada na migration 0096 — generated types ainda
  // nao foram regenerados, por isso `as never`.
  const { data, error } = await supabase.rpc(
    'cancel_appointment' as never,
    {
      p_appointment_id: input.appointmentId,
      p_by: input.actorUserId,
      p_reason: input.reason,
      p_notes: input.notes ?? undefined,
    } as never,
  )

  if (error) {
    const msg = error.message ?? ''
    if (/APPOINTMENT_NOT_FOUND/i.test(msg)) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 'atendimento nao encontrado', {
        status: 404,
      })
    }
    if (/APPOINTMENT_REALIZED/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_REALIZED',
        'atendimento ja realizado nao pode ser cancelado',
        { status: 409 },
      )
    }
    if (/INVALID_REASON/i.test(msg)) {
      throw new DomainError('INVALID_REASON', 'motivo de cancelamento invalido', {
        status: 400,
      })
    }
    // RPC ausente (migration 0096 nao aplicada) — sinaliza claramente.
    if (/could not find the function|function .* does not exist|schema cache/i.test(msg)) {
      throw new DomainError(
        'CANCEL_RPC_NOT_DEPLOYED',
        'A funcao de cancelamento ainda nao esta disponivel no banco. Aplique as migrations 0096 e 0097 em producao.',
        { status: 503 },
      )
    }
    // Demais erros: surface a mensagem original para facilitar debug em prod.
    throw new DomainError('CANCEL_APPOINTMENT_FAILED', `Falha ao cancelar atendimento: ${msg}`, {
      status: 500,
    })
  }

  if (!data) {
    throw new Error('cancelAppointment: empty response')
  }

  return { cancellationId: data as string }
}

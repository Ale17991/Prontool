import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'

/**
 * Marca um atendimento como CONFIRMADO (paciente avisou que vira). Cria row
 * em `appointment_confirmations` (append-only). A view appointments_effective
 * passa a retornar status 'confirmado' para esse atendimento.
 */
export interface ConfirmAppointmentInput {
  appointmentId: string
  actorUserId: string
  notes?: string
}

export interface ConfirmAppointmentResult {
  confirmationId: string
}

export async function confirmAppointment(
  supabase: SupabaseClient<Database>,
  input: ConfirmAppointmentInput,
): Promise<ConfirmAppointmentResult> {
  // 'confirm_appointment' criada na migration 0096 — generated types ainda
  // nao foram regenerados, por isso `as never`.
  const { data, error } = await supabase.rpc('confirm_appointment' as never, {
    p_appointment_id: input.appointmentId,
    p_by: input.actorUserId,
    p_notes: input.notes ?? undefined,
  } as never)

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
        'atendimento estornado nao pode ser confirmado',
        { status: 409 },
      )
    }
    if (/APPOINTMENT_CANCELLED/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_CANCELLED',
        'atendimento cancelado nao pode ser confirmado',
        { status: 409 },
      )
    }
    if (/APPOINTMENT_REALIZED/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_REALIZED',
        'atendimento ja realizado nao precisa de confirmacao',
        { status: 409 },
      )
    }
    throw new Error(`confirmAppointment failed: ${msg}`)
  }

  if (!data) {
    throw new Error('confirmAppointment: empty response')
  }

  return { confirmationId: data as string }
}

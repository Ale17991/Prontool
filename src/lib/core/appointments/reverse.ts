import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'

/**
 * T088a — reverse an appointment by inserting an `appointment_reversals`
 * compensating record whose `reversal_amount_cents = -frozen_amount_cents`.
 * Never mutates the original appointment row (Principle I).
 *
 * Enforces single-reversal via the table's `UNIQUE (appointment_id)` —
 * duplicate inserts surface as SQLSTATE 23505 and get mapped to
 * `ConflictError`. Caller-role validation is the Route Handler's job
 * (T088b); this function assumes authorisation has already been checked.
 */
export interface ReverseAppointmentInput {
  appointmentId: string
  tenantId: string
  actorUserId: string
  reason: string
}

export interface ReverseAppointmentResult {
  reversalId: string
  reversalAmountCents: number
}

export async function reverseAppointment(
  supabase: SupabaseClient<Database>,
  input: ReverseAppointmentInput,
): Promise<ReverseAppointmentResult> {
  const appointment = await supabase
    .from('appointments')
    .select('id, tenant_id, frozen_amount_cents')
    .eq('id', input.appointmentId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (appointment.error) throw new Error(`appointment lookup failed: ${appointment.error.message}`)
  if (!appointment.data) throw new NotFoundError('appointment', input.appointmentId)

  const reversalAmountCents = -appointment.data.frozen_amount_cents

  const inserted = await supabase
    .from('appointment_reversals')
    .insert({
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      reversal_amount_cents: reversalAmountCents,
      reason: input.reason,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (inserted.error) {
    if (inserted.error.code === '23505') {
      throw new ConflictError(
        'APPOINTMENT_ALREADY_REVERSED',
        'This appointment has already been reversed',
        { appointment_id: input.appointmentId },
      )
    }
    throw new Error(`appointment_reversals insert failed: ${inserted.error.message}`)
  }

  return { reversalId: inserted.data.id, reversalAmountCents }
}

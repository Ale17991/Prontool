import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, DomainError, ValidationError } from '@/lib/observability/errors'

export interface AddAssistantInput {
  tenantId: string
  appointmentId: string
  assistantDoctorId: string
  amountCents: number
  actorUserId: string
}

export interface AddAssistantResult {
  id: string
  frozenAmountCents: number
}

const MAX_CENTS = 100_000_00 // R$ 100k sanity cap (alinhado com CHECK em DB)

/**
 * Anexa um assistente Liberal a um atendimento via RPC
 * `attach_assistant_to_appointment` (SECURITY DEFINER).
 *
 * O RPC valida tenant, bloqueia atendimento estornado, e triggers BEFORE
 * INSERT garantem (a) tenant consistency e (b) que o doctor tem
 * payment_mode='liberal' (defense in depth). Duplicata ativa cai no
 * UNIQUE parcial → '23505'.
 */
export async function addAssistant(
  supabase: SupabaseClient<Database>,
  input: AddAssistantInput,
): Promise<AddAssistantResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError('Valor da participação deve ser inteiro positivo (em centavos)')
  }
  if (input.amountCents >= MAX_CENTS) {
    throw new ValidationError('Valor da participação acima do limite permitido')
  }

  const { data, error } = await supabase.rpc(
    'attach_assistant_to_appointment' as never,
    {
      p_appointment_id: input.appointmentId,
      p_assistant_doctor_id: input.assistantDoctorId,
      p_amount_cents: input.amountCents,
      p_actor: input.actorUserId,
    } as never,
  )

  if (error) {
    const msg = error.message ?? ''
    if (/APPOINTMENT_NOT_FOUND/.test(msg)) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 'Atendimento não encontrado.', { status: 404 })
    }
    if (/APPOINTMENT_REVERSED/.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_REVERSED',
        'Atendimento estornado — não permite novos assistentes.',
        { status: 409 },
      )
    }
    if (/ASSISTANT_NOT_LIBERAL/.test(msg)) {
      throw new DomainError(
        'ASSISTANT_NOT_LIBERAL',
        'Apenas profissionais com modalidade Liberal podem ser adicionados como assistente.',
        { status: 400 },
      )
    }
    if (/ASSISTANT_TENANT_MISMATCH/.test(msg)) {
      throw new DomainError('ASSISTANT_TENANT_MISMATCH', 'Profissional pertence a outra clínica.', {
        status: 400,
      })
    }
    if (error.code === '23505') {
      throw new ConflictError(
        'DUPLICATE_ACTIVE_ASSISTANT',
        'Este profissional já está anexado como assistente ativo deste atendimento.',
      )
    }
    throw new Error(`attach_assistant_to_appointment failed: ${msg}`)
  }

  return {
    id: data as unknown as string,
    frozenAmountCents: input.amountCents,
  }
}

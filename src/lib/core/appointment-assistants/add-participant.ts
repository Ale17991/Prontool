import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, DomainError, ValidationError } from '@/lib/observability/errors'
import { isValidParticipationDegree } from '@/lib/core/tiss/domains'

export interface AddParticipantInput {
  tenantId: string
  appointmentId: string
  /** Linha de `appointment_procedures` à qual a participação pertence. */
  procedureId: string
  /** Médico participante (qualquer modalidade ativa). */
  doctorId: string
  /** Código do grau de participação (domínio TISS 35). */
  participationDegree: string
  /** Honorário congelado, em centavos (> 0). */
  amountCents: number
  actorUserId: string
}

export interface AddParticipantResult {
  id: string
  frozenAmountCents: number
}

const MAX_CENTS = 100_000_00 // R$ 100k — alinhado ao CHECK em DB

/**
 * Feature 031 — anexa um participante (equipe) a uma LINHA DE PROCEDIMENTO via
 * RPC `attach_assistant_to_appointment` (SECURITY DEFINER), agora com
 * `p_procedure_id` + `p_participation_degree`.
 *
 * Diferenças vs. `addAssistant` (legado, por atendimento e só liberal):
 *  - exige `procedureId` e `participationDegree` (validado contra o domínio 35);
 *  - aceita médico de QUALQUER modalidade (o trigger liberal-only foi relaxado
 *    na 0128 para exigir apenas médico ativo do tenant).
 */
export async function addParticipant(
  supabase: SupabaseClient<Database>,
  input: AddParticipantInput,
): Promise<AddParticipantResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError('Honorário deve ser inteiro positivo (em centavos)')
  }
  if (input.amountCents >= MAX_CENTS) {
    throw new ValidationError('Honorário acima do limite permitido')
  }
  if (!input.procedureId) {
    throw new ValidationError('Procedimento é obrigatório')
  }

  // FR-006/FR-013 — grau nunca é texto livre; vem do catálogo oficial (dom. 35).
  const degreeOk = await isValidParticipationDegree(supabase, input.participationDegree)
  if (!degreeOk) {
    throw new DomainError(
      'INVALID_DEGREE',
      'Grau de participação inválido (fora do domínio TISS 35).',
      { status: 422 },
    )
  }

  const { data, error } = await supabase.rpc('attach_assistant_to_appointment' as never, {
    p_appointment_id: input.appointmentId,
    p_assistant_doctor_id: input.doctorId,
    p_amount_cents: input.amountCents,
    p_actor: input.actorUserId,
    p_procedure_id: input.procedureId,
    p_participation_degree: input.participationDegree,
  } as never)

  if (error) {
    const msg = error.message ?? ''
    if (/APPOINTMENT_NOT_FOUND/.test(msg)) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 'Atendimento não encontrado.', { status: 404 })
    }
    if (/APPOINTMENT_REVERSED/.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_REVERSED',
        'Atendimento estornado — não permite novos participantes.',
        { status: 409 },
      )
    }
    if (/ASSISTANT_DOCTOR_NOT_FOUND/.test(msg)) {
      throw new DomainError('DOCTOR_NOT_FOUND', 'Profissional não encontrado.', { status: 404 })
    }
    if (/ASSISTANT_DOCTOR_INACTIVE/.test(msg)) {
      throw new DomainError('DOCTOR_INACTIVE', 'Profissional inativo não pode participar.', {
        status: 400,
      })
    }
    if (/ASSISTANT_PROCEDURE_MISMATCH/.test(msg) || /procedure .* nao encontrado/i.test(msg)) {
      throw new DomainError(
        'PROCEDURE_NOT_FOUND',
        'Procedimento não pertence a este atendimento.',
        { status: 404 },
      )
    }
    if (/ASSISTANT_TENANT_MISMATCH/.test(msg)) {
      throw new DomainError('TENANT_MISMATCH', 'Profissional pertence a outra clínica.', {
        status: 400,
      })
    }
    if (error.code === '23505') {
      throw new ConflictError(
        'PARTICIPANT_DUPLICATE',
        'Este profissional já está na equipe ativa deste procedimento.',
      )
    }
    throw new Error(`addParticipant failed: ${msg}`)
  }

  return {
    id: data as unknown as string,
    frozenAmountCents: input.amountCents,
  }
}

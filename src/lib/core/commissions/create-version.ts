import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * T125 — Append-only: INSERT nova row em `doctor_commission_history`.
 * O audit trigger `audit_commission_insert` (migration 0013) já
 * registra a mudança com o percentual anterior.
 *
 * Constraint UNIQUE (tenant_id, doctor_id, valid_from) vira
 * ConflictError — duas mudanças para a mesma data não são permitidas.
 */
export interface CreateCommissionVersionInput {
  tenantId: string
  doctorId: string
  percentageBps: number
  validFrom: string
  reason: string
  actorUserId: string
}

export interface CreatedCommissionVersion {
  id: string
  doctorId: string
  percentageBps: number
  validFrom: string
  reason: string
  createdAt: string
}

export async function createCommissionVersion(
  supabase: SupabaseClient<Database>,
  input: CreateCommissionVersionInput,
): Promise<CreatedCommissionVersion> {
  if (input.percentageBps < 0 || input.percentageBps > 10_000) {
    throw new ValidationError('Comissão deve estar entre 0 e 10000 bps (0%–100%)')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) {
    throw new ValidationError('valid_from deve estar no formato YYYY-MM-DD')
  }
  if (input.reason.trim().length < 3) {
    throw new ValidationError('Motivo deve ter ao menos 3 caracteres')
  }

  // FK to doctors is enforced by the DB, but we pre-check so we can return
  // a friendly 404 instead of a raw FK violation.
  const { data: doctor } = await supabase
    .from('doctors')
    .select('id')
    .eq('id', input.doctorId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (!doctor) throw new NotFoundError('doctor', input.doctorId)

  const { data, error } = await supabase
    .from('doctor_commission_history')
    .insert({
      tenant_id: input.tenantId,
      doctor_id: input.doctorId,
      percentage_bps: input.percentageBps,
      valid_from: input.validFrom,
      reason: input.reason.trim(),
      created_by: input.actorUserId,
    })
    .select('id, doctor_id, percentage_bps, valid_from, reason, created_at')
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      throw new ConflictError(
        'COMMISSION_DUPLICATE_VALID_FROM',
        `Já existe uma comissão registrada em ${input.validFrom} para este médico`,
        { doctor_id: input.doctorId, valid_from: input.validFrom },
      )
    }
    throw new Error(`createCommissionVersion failed: ${error?.message ?? 'unknown'}`)
  }

  return {
    id: data.id,
    doctorId: data.doctor_id,
    percentageBps: data.percentage_bps,
    validFrom: data.valid_from,
    reason: data.reason,
    createdAt: data.created_at,
  }
}

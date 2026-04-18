import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'

/**
 * T123 — Cria médico + linha inicial de `doctor_commission_history`.
 * A operação é um par de INSERTs com rollback manual: se o insert da
 * comissão falhar, removemos a row do médico (service_role bypassa
 * o append-only trigger em `doctors`, que não tem guarda de mutação).
 *
 * Validações:
 *   - CRM non-empty (formato livre pra acomodar variações estaduais)
 *   - external_identifier opcional (matching com custom field GHL)
 *   - percentage_bps 0..10000, validado pelo CHECK na migration 0005
 *   - reason >= 3 chars (CHECK na migration 0005)
 */
export interface CreateDoctorInput {
  tenantId: string
  fullName: string
  crm: string
  externalIdentifier?: string | null
  initialPercentageBps: number
  initialValidFrom: string
  initialReason: string
  actorUserId: string
}

export interface CreatedDoctor {
  id: string
  fullName: string
  crm: string
  externalIdentifier: string | null
  active: boolean
  createdAt: string
  currentPercentageBps: number
  currentValidFrom: string
  commissionHistoryId: string
}

export async function createDoctor(
  supabase: SupabaseClient<Database>,
  input: CreateDoctorInput,
): Promise<CreatedDoctor> {
  const crm = input.crm.trim()
  if (!crm) throw new ValidationError('CRM obrigatório')
  if (!input.fullName.trim()) throw new ValidationError('Nome completo obrigatório')
  if (input.initialPercentageBps < 0 || input.initialPercentageBps > 10_000) {
    throw new ValidationError('Comissão deve estar entre 0 e 10000 bps (0%–100%)')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.initialValidFrom)) {
    throw new ValidationError('valid_from deve estar no formato YYYY-MM-DD')
  }
  if (input.initialReason.trim().length < 3) {
    throw new ValidationError('Motivo da comissão deve ter ao menos 3 caracteres')
  }

  const doctorInsert = await supabase
    .from('doctors')
    .insert({
      tenant_id: input.tenantId,
      full_name: input.fullName.trim(),
      crm,
      external_identifier: input.externalIdentifier?.trim() || null,
      created_by: input.actorUserId,
    })
    .select('id, full_name, crm, external_identifier, active, created_at')
    .single()

  if (doctorInsert.error) {
    if (doctorInsert.error.code === '23505') {
      // Could be the (tenant_id, crm) unique or the partial external_identifier unique.
      const msg = /external/i.test(doctorInsert.error.message)
        ? `Identificador externo já usado por outro médico`
        : `Já existe um médico com o CRM ${crm} neste tenant`
      throw new ConflictError('DOCTOR_DUPLICATE', msg, {
        crm,
        external_identifier: input.externalIdentifier ?? null,
      })
    }
    throw new Error(`createDoctor failed: ${doctorInsert.error.message}`)
  }
  const doctor = doctorInsert.data

  const commissionInsert = await supabase
    .from('doctor_commission_history')
    .insert({
      tenant_id: input.tenantId,
      doctor_id: doctor.id,
      percentage_bps: input.initialPercentageBps,
      valid_from: input.initialValidFrom,
      reason: input.initialReason.trim(),
      created_by: input.actorUserId,
    })
    .select('id, percentage_bps, valid_from')
    .single()

  if (commissionInsert.error || !commissionInsert.data) {
    await supabase.from('doctors').delete().eq('id', doctor.id).eq('tenant_id', input.tenantId)
    throw new Error(
      `createDoctor commission insert failed: ${commissionInsert.error?.message ?? 'unknown'}`,
    )
  }

  return {
    id: doctor.id,
    fullName: doctor.full_name,
    crm: doctor.crm,
    externalIdentifier: doctor.external_identifier,
    active: doctor.active,
    createdAt: doctor.created_at,
    currentPercentageBps: commissionInsert.data.percentage_bps,
    currentValidFrom: commissionInsert.data.valid_from,
    commissionHistoryId: commissionInsert.data.id,
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * T124 — Atualiza `full_name`, `active` e os campos do prescritor exigidos
 * pela Memed (`cpf`, `council_state`, `birth_date`). CRM/council_name/
 * council_number permanecem imutáveis (ids externos como CRM referenciam
 * atendimentos antigos; mudar depois quebraria reconciliações). A RLS policy
 * `doctors_admin_update` já exige admin.
 *
 * Campos do prescritor aceitam `null` para limpar e `string` para definir;
 * `undefined` significa "não mexer".
 */
export interface UpdateDoctorInput {
  tenantId: string
  doctorId: string
  patch: {
    fullName?: string
    active?: boolean
    cpf?: string | null
    councilState?: string | null
    birthDate?: string | null
  }
}

export interface UpdatedDoctor {
  id: string
  fullName: string
  active: boolean
  cpf: string | null
  councilState: string | null
  birthDate: string | null
}

export async function updateDoctor(
  supabase: SupabaseClient<Database>,
  input: UpdateDoctorInput,
): Promise<UpdatedDoctor> {
  const updates: {
    full_name?: string
    active?: boolean
    cpf?: string | null
    council_state?: string | null
    birth_date?: string | null
  } = {}
  if (input.patch.fullName !== undefined) updates.full_name = input.patch.fullName.trim()
  if (typeof input.patch.active === 'boolean') updates.active = input.patch.active
  if (input.patch.cpf !== undefined) updates.cpf = input.patch.cpf?.trim() || null
  if (input.patch.councilState !== undefined) {
    updates.council_state = input.patch.councilState?.trim().toUpperCase() || null
  }
  if (input.patch.birthDate !== undefined) updates.birth_date = input.patch.birthDate || null
  if (Object.keys(updates).length === 0) throw new Error('updateDoctor: nothing to update')

  const { data, error } = await supabase
    .from('doctors')
    .update(updates)
    .eq('id', input.doctorId)
    .eq('tenant_id', input.tenantId)
    .select('id, full_name, active, cpf, council_state, birth_date')
    .maybeSingle()
  if (error) throw new Error(`updateDoctor failed: ${error.message}`)
  if (!data) throw new NotFoundError('doctor', input.doctorId)

  return {
    id: data.id,
    fullName: data.full_name,
    active: data.active,
    cpf: data.cpf,
    councilState: data.council_state,
    birthDate: data.birth_date,
  }
}

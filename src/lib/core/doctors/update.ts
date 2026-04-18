import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * T124 — Atualiza apenas `full_name` e/ou `active`. CRM é imutável (ids
 * externos como CRM referenciam atendimentos antigos; mudar depois
 * quebraria reconciliações). A RLS policy `doctors_admin_update` já
 * exige admin.
 */
export interface UpdateDoctorInput {
  tenantId: string
  doctorId: string
  patch: { fullName?: string; active?: boolean }
}

export async function updateDoctor(
  supabase: SupabaseClient<Database>,
  input: UpdateDoctorInput,
): Promise<{ id: string; fullName: string; active: boolean }> {
  const updates: { full_name?: string; active?: boolean } = {}
  if (input.patch.fullName !== undefined) updates.full_name = input.patch.fullName.trim()
  if (typeof input.patch.active === 'boolean') updates.active = input.patch.active
  if (Object.keys(updates).length === 0) throw new Error('updateDoctor: nothing to update')

  const { data, error } = await supabase
    .from('doctors')
    .update(updates)
    .eq('id', input.doctorId)
    .eq('tenant_id', input.tenantId)
    .select('id, full_name, active')
    .maybeSingle()
  if (error) throw new Error(`updateDoctor failed: ${error.message}`)
  if (!data) throw new NotFoundError('doctor', input.doctorId)

  return { id: data.id, fullName: data.full_name, active: data.active }
}

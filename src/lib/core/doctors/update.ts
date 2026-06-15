import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * T124 — Atualiza `full_name`, `active`, especialidade e os campos do prescritor
 * exigidos pela Memed (`cpf`, `council_name`, `council_number`, `council_state`,
 * `birth_date`). O `crm` LEGADO permanece imutável (referencia atendimentos
 * antigos); `council_*` são editáveis para completar cadastros pré-0107 (ex.:
 * número do conselho ausente, que bloqueia a prescrição). RLS exige admin.
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
    councilName?: string | null
    councilNumber?: string | null
    councilState?: string | null
    birthDate?: string | null
    /** Especialidade (nome do catálogo Memed). Fonte única do display. */
    specialty?: string | null
  }
}

export interface UpdatedDoctor {
  id: string
  fullName: string
  active: boolean
  cpf: string | null
  councilName: string | null
  councilNumber: string | null
  councilState: string | null
  birthDate: string | null
  specialty: string | null
}

export async function updateDoctor(
  supabase: SupabaseClient<Database>,
  input: UpdateDoctorInput,
): Promise<UpdatedDoctor> {
  const updates: {
    full_name?: string
    active?: boolean
    cpf?: string | null
    crm?: string
    council_name?: string | null
    council_number?: string | null
    council_state?: string | null
    birth_date?: string | null
    specialty?: string | null
  } = {}
  if (input.patch.fullName !== undefined) updates.full_name = input.patch.fullName.trim()
  if (typeof input.patch.active === 'boolean') updates.active = input.patch.active
  if (input.patch.cpf !== undefined) updates.cpf = input.patch.cpf?.trim() || null
  if (input.patch.councilName !== undefined) {
    updates.council_name = input.patch.councilName?.trim().toUpperCase() || null
  }
  if (input.patch.councilNumber !== undefined) {
    const num = input.patch.councilNumber?.trim() || null
    updates.council_number = num
    // Mantém o `crm` legado em sincronia com o número do conselho (a criação
    // já usa crm = número) — evita o desencontro que confundia o cabeçalho.
    if (num) updates.crm = num
  }
  if (input.patch.councilState !== undefined) {
    updates.council_state = input.patch.councilState?.trim().toUpperCase() || null
  }
  if (input.patch.birthDate !== undefined) updates.birth_date = input.patch.birthDate || null
  if (input.patch.specialty !== undefined) updates.specialty = input.patch.specialty?.trim() || null
  if (Object.keys(updates).length === 0) throw new Error('updateDoctor: nothing to update')

  const { data, error } = await supabase
    .from('doctors')
    .update(updates)
    .eq('id', input.doctorId)
    .eq('tenant_id', input.tenantId)
    .select('id, full_name, active, cpf, council_name, council_number, council_state, birth_date, specialty')
    .maybeSingle()
  if (error) throw new Error(`updateDoctor failed: ${error.message}`)
  if (!data) throw new NotFoundError('doctor', input.doctorId)

  const d = data as {
    id: string
    full_name: string
    active: boolean
    cpf: string | null
    council_name: string | null
    council_number: string | null
    council_state: string | null
    birth_date: string | null
    specialty: string | null
  }
  return {
    id: d.id,
    fullName: d.full_name,
    active: d.active,
    cpf: d.cpf,
    councilName: d.council_name,
    councilNumber: d.council_number,
    councilState: d.council_state,
    birthDate: d.birth_date,
    specialty: d.specialty,
  }
}

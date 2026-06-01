import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import type { PatientSex } from './get'

export interface UpdatePatientIdentityInput {
  tenantId: string
  patientId: string
  fields: {
    /** `sex` é em claro; null limpa. */
    sex?: PatientSex | null
    /** Contato principal (exigidos pela Memed para prescrever). */
    phone?: string | null
    email?: string | null
    socialName?: string | null
    motherName?: string | null
    rg?: string | null
    insuranceCardNumber?: string | null
    emergencyContactName?: string | null
    emergencyContactPhone?: string | null
    guardianName?: string | null
    guardianCpf?: string | null
    guardianRelationship?: string | null
  }
}

// Mapeia cada campo de entrada à coluna cifrada correspondente.
const ENC_COLUMNS: ReadonlyArray<
  [keyof UpdatePatientIdentityInput['fields'], string]
> = [
  ['phone', 'phone_enc'],
  ['email', 'email_enc'],
  ['socialName', 'social_name_enc'],
  ['motherName', 'mother_name_enc'],
  ['rg', 'rg_enc'],
  ['insuranceCardNumber', 'insurance_card_number_enc'],
  ['emergencyContactName', 'emergency_contact_name_enc'],
  ['emergencyContactPhone', 'emergency_contact_phone_enc'],
  ['guardianName', 'guardian_name_enc'],
  ['guardianCpf', 'guardian_cpf_enc'],
  ['guardianRelationship', 'guardian_relationship_enc'],
]

/**
 * Atualiza campos de identificação clínica do paciente. PII é cifrada com a
 * chave de dados; `null`/'' limpa o campo. `sex` é coluna em claro. Campos não
 * enviados (undefined) ficam inalterados. Mesmo padrão de `updatePatientAddress`.
 */
export async function updatePatientIdentity(
  supabase: SupabaseClient<Database>,
  input: UpdatePatientIdentityInput,
): Promise<void> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to encrypt patient identity fields')
  }

  const update: Record<string, unknown> = {}

  // `sex` em claro.
  if (input.fields.sex !== undefined) {
    update.sex = input.fields.sex ?? null
  }

  for (const [field, column] of ENC_COLUMNS) {
    const value = input.fields[field] as string | null | undefined
    if (value === undefined) continue
    if (value === null || value.trim() === '') {
      update[column] = null
    } else {
      update[column] = await encrypt(supabase, value.trim(), key)
    }
  }

  if (Object.keys(update).length === 0) return

  const result = await supabase
    .from('patients')
    .update(update as Database['public']['Tables']['patients']['Update'])
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .select('id')
    .maybeSingle()

  if (result.error) throw new Error(`updatePatientIdentity failed: ${result.error.message}`)
  if (!result.data) throw new NotFoundError('patient', input.patientId)
}

async function encrypt(
  supabase: SupabaseClient<Database>,
  plain: string,
  key: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key })
  if (error || data === null || data === undefined) {
    throw new Error(`enc_text_with_key RPC failed: ${error?.message ?? 'null ciphertext'}`)
  }
  return data as unknown as string
}

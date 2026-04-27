import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

export interface UpdatePatientAddressInput {
  tenantId: string
  patientId: string
  address: {
    cep?: string | null
    street?: string | null
    number?: string | null
    complement?: string | null
    neighborhood?: string | null
    city?: string | null
    state?: string | null
  }
}

/**
 * Atualiza colunas de endereço do paciente. Cifra cada valor com a chave
 * de PII; null limpa explicitamente o campo. Campos não enviados ficam
 * inalterados (compose o update apenas com keys presentes).
 */
export async function updatePatientAddress(
  supabase: SupabaseClient<Database>,
  input: UpdatePatientAddressInput,
): Promise<void> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to encrypt patient address')
  }

  const update: Database['public']['Tables']['patients']['Update'] = {}

  for (const [field, column] of [
    ['cep', 'address_cep_enc'],
    ['street', 'address_street_enc'],
    ['number', 'address_number_enc'],
    ['complement', 'address_complement_enc'],
    ['neighborhood', 'address_neighborhood_enc'],
    ['city', 'address_city_enc'],
    ['state', 'address_state_enc'],
  ] as const) {
    const value = input.address[field]
    if (value === undefined) continue
    if (value === null || value.trim() === '') {
      ;(update as Record<string, unknown>)[column] = null
    } else {
      const enc = await encrypt(supabase, value.trim(), key)
      ;(update as Record<string, unknown>)[column] = enc
    }
  }

  if (Object.keys(update).length === 0) return

  const result = await supabase
    .from('patients')
    .update(update)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .select('id')
    .maybeSingle()

  if (result.error) throw new Error(`updatePatientAddress failed: ${result.error.message}`)
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

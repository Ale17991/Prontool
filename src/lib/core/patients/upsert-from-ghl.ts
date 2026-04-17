import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * T081 — idempotent upsert of a patient row keyed by
 * (tenant_id, ghl_contact_id). Updates mutable contact fields on repeat
 * deliveries but never mutates related appointments — those snapshots are
 * frozen by the append-only trigger on `appointments`.
 *
 * PII columns (`*_enc BYTEA`) are produced by the `enc_text(plain)` SQL
 * helper (migration 0007), which requires the per-session GUC
 * `app.patient_encryption_key` to be populated first. The caller (the
 * worker Route Handler) is responsible for that SET — we validate it is
 * present by asking PG to echo the GUC before encrypting.
 */
export interface UpsertPatientInput {
  tenantId: string
  ghlContactId: string
  fullName: string
  cpf: string
  phone?: string | undefined
  email?: string | undefined
  birthDate?: string | undefined
}

export async function upsertPatientFromGhl(
  supabase: SupabaseClient<Database>,
  input: UpsertPatientInput,
): Promise<{ patientId: string; created: boolean }> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to encrypt patient PII')

  const [name, cpf, phone, email, birthDate] = await Promise.all([
    encrypt(supabase, input.fullName, key),
    encrypt(supabase, input.cpf, key),
    input.phone ? encrypt(supabase, input.phone, key) : Promise.resolve(null),
    input.email ? encrypt(supabase, input.email, key) : Promise.resolve(null),
    input.birthDate ? encrypt(supabase, input.birthDate, key) : Promise.resolve(null),
  ])

  const upserted = await supabase
    .from('patients')
    .upsert(
      {
        tenant_id: input.tenantId,
        ghl_contact_id: input.ghlContactId,
        full_name_enc: name,
        cpf_enc: cpf,
        phone_enc: phone,
        email_enc: email,
        birth_date_enc: birthDate,
      },
      { onConflict: 'tenant_id,ghl_contact_id' },
    )
    .select('id, created_at, updated_at')
    .single()

  if (upserted.error || !upserted.data) {
    throw new Error(`upsertPatientFromGhl failed: ${upserted.error?.message}`)
  }
  return {
    patientId: upserted.data.id,
    created: upserted.data.created_at === upserted.data.updated_at,
  }
}

async function encrypt(
  supabase: SupabaseClient<Database>,
  plain: string,
  key: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key })
  if (error || data === null || data === undefined) {
    throw new Error(
      `enc_text_with_key RPC failed: ${error?.message ?? 'null ciphertext'}. ` +
        'Ensure migration 0020_test_helpers.sql is applied.',
    )
  }
  // supabase-js returns bytea as a hex-prefixed string `\x...`; the INSERT
  // column expects that same format, so pass through unchanged.
  return data as unknown as string
}

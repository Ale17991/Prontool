import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import type { Database } from '@/lib/db/types'
import type { TenantIntegrationRow } from './config'

/**
 * Decrypt the `credentials_enc` BYTEA column for a tenant×provider row and
 * validate it against the adapter's `credentialsSchema`. Credentials are
 * stored as a JSON string inside the encrypted blob.
 *
 * Callers MUST have already loaded the row via `getIntegrationConfig` or
 * `getEnabledIntegrations` — this function takes the row (not a fetch) so
 * the caller retains responsibility for tenant scoping.
 */
export async function decryptCredentials<C>(
  supabase: SupabaseClient<Database>,
  row: TenantIntegrationRow,
  schema: z.ZodType<C>,
): Promise<C> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to decrypt integration credentials')
  }
  const { data, error } = await supabase.rpc('dec_text_with_key', {
    cipher: row.credentials_enc as unknown as string,
    key,
  })
  if (error || data === null || data === undefined) {
    throw new Error(`dec_text_with_key failed for ${row.provider}: ${error?.message ?? 'null plaintext'}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(data as unknown as string)
  } catch {
    throw new Error(`credentials for ${row.provider} are not valid JSON after decrypt`)
  }
  return schema.parse(parsed)
}

/**
 * Encrypt a credentials object for persistence. Inverse of decryptCredentials.
 */
export async function encryptCredentials(
  supabase: SupabaseClient<Database>,
  credentials: unknown,
): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to encrypt integration credentials')
  }
  const { data, error } = await supabase.rpc('enc_text_with_key', {
    plain: JSON.stringify(credentials),
    key,
  })
  if (error || data === null || data === undefined) {
    throw new Error(`enc_text_with_key failed: ${error?.message ?? 'null ciphertext'}`)
  }
  return data as unknown as string
}

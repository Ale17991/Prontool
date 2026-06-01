import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { memedCredentialsSchema, type MemedCredentials, type MemedEnvironment } from './types'

/**
 * Leitura/escrita das credenciais Memed cifradas (`tenant_memed_config`).
 *
 * As chaves vivem cifradas em `api_key_enc`/`secret_key_enc` (BYTEA) e só são
 * decifradas server-side via `dec_text_with_key` com `PATIENT_DATA_ENCRYPTION_KEY`.
 * NENHUMA rota deve serializar o retorno de `getMemedConnection` ao browser —
 * use `MemedConfigPublic` para isso.
 */

export interface MemedConnection {
  environment: MemedEnvironment
  connected: boolean
  termsAcceptedAt: string | null
  credentials: MemedCredentials
}

function requireKey(): string {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to handle Memed credentials')
  }
  return key
}

async function decBytea(
  supabase: SupabaseClient<Database>,
  cipher: string,
  key: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('dec_text_with_key', { cipher, key })
  if (error || data === null || data === undefined) {
    throw new Error(`dec_text_with_key failed: ${error?.message ?? 'null plaintext'}`)
  }
  return data as unknown as string
}

async function encText(
  supabase: SupabaseClient<Database>,
  plain: string,
  key: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key })
  if (error || data === null || data === undefined) {
    throw new Error(`enc_text_with_key failed: ${error?.message ?? 'null ciphertext'}`)
  }
  return data as unknown as string
}

/**
 * Carrega a conexão Memed de um tenant com as credenciais já decifradas.
 * Retorna `null` se a clínica não tem conta Memed configurada.
 *
 * O `supabase` deve ter escopo apropriado para ler as colunas cifradas
 * (service client) — o caller é responsável pelo tenant scoping.
 */
export async function getMemedConnection(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<MemedConnection | null> {
  const { data, error } = await supabase
    .from('tenant_memed_config')
    .select('environment, connected, terms_accepted_at, api_key_enc, secret_key_enc')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`failed to load tenant_memed_config: ${error.message}`)
  if (!data) return null

  const key = requireKey()
  const [apiKey, secretKey] = await Promise.all([
    decBytea(supabase, data.api_key_enc as unknown as string, key),
    decBytea(supabase, data.secret_key_enc as unknown as string, key),
  ])

  const credentials = memedCredentialsSchema.parse({ api_key: apiKey, secret_key: secretKey })

  return {
    environment: data.environment as MemedEnvironment,
    connected: data.connected,
    termsAcceptedAt: data.terms_accepted_at,
    credentials,
  }
}

/**
 * Cifra um par de credenciais para persistência em `tenant_memed_config`.
 * Devolve os dois ciphertexts (hex `\x...`) prontos para INSERT/UPDATE.
 */
export async function encryptMemedCredentials(
  supabase: SupabaseClient<Database>,
  credentials: MemedCredentials,
): Promise<{ api_key_enc: string; secret_key_enc: string }> {
  const parsed = memedCredentialsSchema.parse(credentials)
  const key = requireKey()
  const [api_key_enc, secret_key_enc] = await Promise.all([
    encText(supabase, parsed.api_key, key),
    encText(supabase, parsed.secret_key, key),
  ])
  return { api_key_enc, secret_key_enc }
}

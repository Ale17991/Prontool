import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { decryptCredentials, encryptCredentials } from '@/lib/core/integrations/credentials'
import {
  googleOAuthCredentialsSchema,
  googleCalendarConfigSchema,
  type GoogleOAuthCredentials,
  type GoogleCalendarConfig,
} from './types'

/**
 * Leitura/escrita dos tokens do Google na tabela POR USUÁRIO
 * `user_integrations` (provider='google_calendar'). Reusa o mesmo
 * enc/dec_text_with_key (key PATIENT_DATA_ENCRYPTION_KEY) de tenant_integrations.
 *
 * Tabela nova (0124) ainda não tipada nos generated types → cliente solto.
 */

const PROVIDER = 'google_calendar'

function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

export interface UserIntegrationRow {
  user_id: string
  tenant_id: string
  provider: string
  config: GoogleCalendarConfig
  credentials_enc: string | null
  status: string
  enabled: boolean
  updated_at: string
}

export interface GoogleConnection {
  row: UserIntegrationRow
  config: GoogleCalendarConfig
  credentials: GoogleOAuthCredentials | null
}

/** Carrega a conexão Google do usuário×clínica, ou null se não conectado. */
export async function readGoogleConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
  tenantId: string,
): Promise<GoogleConnection | null> {
  const { data, error } = await loose(supabase)
    .from('user_integrations')
    .select('user_id, tenant_id, provider, config, credentials_enc, status, enabled, updated_at')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .eq('provider', PROVIDER)
    .maybeSingle()
  if (error) throw new Error(`readGoogleConnection: ${error.message}`)
  if (!data) return null
  const row = data as unknown as UserIntegrationRow
  const config = googleCalendarConfigSchema.parse(row.config ?? {})
  let credentials: GoogleOAuthCredentials | null = null
  if (row.credentials_enc) {
    credentials = await decryptCredentials(
      supabase,
      { provider: PROVIDER, credentials_enc: row.credentials_enc } as never,
      googleOAuthCredentialsSchema,
    )
  }
  return { row, config, credentials }
}

/** Upsert da conexão com novos tokens + config (callback OAuth / reconexão). */
export async function writeGoogleConnection(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string
    tenantId: string
    credentials: GoogleOAuthCredentials
    config: GoogleCalendarConfig
  },
): Promise<void> {
  const credsEnc = await encryptCredentials(supabase, args.credentials)
  const now = new Date().toISOString()
  const { error } = await loose(supabase)
    .from('user_integrations')
    .upsert(
      {
        user_id: args.userId,
        tenant_id: args.tenantId,
        provider: PROVIDER,
        config: args.config,
        credentials_enc: credsEnc,
        status: 'connected',
        enabled: true,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,tenant_id,provider' },
    )
  if (error) throw new Error(`writeGoogleConnection: ${error.message}`)
}

/** Só os tokens (refresh path) — preserva config. */
export async function writeGoogleTokens(
  supabase: SupabaseClient<Database>,
  args: { userId: string; tenantId: string; credentials: GoogleOAuthCredentials },
): Promise<void> {
  const credsEnc = await encryptCredentials(supabase, args.credentials)
  const { error } = await loose(supabase)
    .from('user_integrations')
    .update({ credentials_enc: credsEnc, status: 'connected', updated_at: new Date().toISOString() })
    .eq('user_id', args.userId)
    .eq('tenant_id', args.tenantId)
    .eq('provider', PROVIDER)
  if (error) throw new Error(`writeGoogleTokens: ${error.message}`)
}

export type MarkExpiredResult = { kind: 'marked' } | { kind: 'lost_race' }

/** Marca token_expired com CAS sobre updated_at (evita corrida no refresh). */
export async function markGoogleExpired(
  supabase: SupabaseClient<Database>,
  args: { userId: string; tenantId: string; expectedUpdatedAt: string },
): Promise<MarkExpiredResult> {
  const { data, error } = await loose(supabase)
    .from('user_integrations')
    .update({ status: 'token_expired', updated_at: new Date().toISOString() })
    .eq('user_id', args.userId)
    .eq('tenant_id', args.tenantId)
    .eq('provider', PROVIDER)
    .eq('updated_at', args.expectedUpdatedAt)
    .select('updated_at')
  if (error) throw new Error(`markGoogleExpired: ${error.message}`)
  return !data || data.length === 0 ? { kind: 'lost_race' } : { kind: 'marked' }
}

/** Desconecta (apaga a linha). */
export async function deleteGoogleConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
  tenantId: string,
): Promise<void> {
  const { error } = await loose(supabase)
    .from('user_integrations')
    .delete()
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .eq('provider', PROVIDER)
  if (error) throw new Error(`deleteGoogleConnection: ${error.message}`)
}

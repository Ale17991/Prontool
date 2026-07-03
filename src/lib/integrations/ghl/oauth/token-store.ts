import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { decryptCredentials, encryptCredentials } from '@/lib/core/integrations/credentials'
import { getIntegrationConfig, type TenantIntegrationRow } from '@/lib/core/integrations/config'
import { ghlOAuthCredentialsSchema, type GhlOAuthCredentials } from './types'

/**
 * Feature 008 — leitura/escrita do par de tokens OAuth cifrado em
 * `tenant_integrations.credentials_enc`. Reutiliza
 * `encryptCredentials/decryptCredentials` do core (mesma key
 * simétrica `PATIENT_DATA_ENCRYPTION_KEY`).
 */

export class NotConnectedError extends Error {
  readonly code = 'NOT_CONNECTED'
  constructor(tenantId: string) {
    super(`tenant ${tenantId} sem linha tenant_integrations(provider='ghl')`)
    this.name = 'NotConnectedError'
  }
}

export interface ReadTokensResult {
  row: TenantIntegrationRow
  credentials: GhlOAuthCredentials
}

/**
 * Carrega a linha tenant_integrations para o tenant + GHL e devolve
 * credentials decifradas + validadas via Zod. Lança `NotConnectedError`
 * se ainda não há linha. NÃO faz checagem de status — caller decide o
 * que fazer com `disconnected`/`token_expired`.
 */
export async function readTokens(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<ReadTokensResult> {
  const row = await getIntegrationConfig(supabase, tenantId, 'ghl')
  if (!row) throw new NotConnectedError(tenantId)
  const credentials = await decryptCredentials(supabase, row, ghlOAuthCredentialsSchema)
  return { row, credentials }
}

/**
 * Persiste novos tokens + status='connected' em uma única operação.
 * NÃO toca config (caller pode chamar `updateConfig` separadamente).
 * Atualiza `connected_at` se `markConnectedNow=true`.
 */
export async function writeTokens(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  credentials: GhlOAuthCredentials,
  opts: { markConnectedNow?: boolean } = {},
): Promise<void> {
  const credsEnc = await encryptCredentials(supabase, credentials)
  const update: Database['public']['Tables']['tenant_integrations']['Update'] = {
    credentials_enc: credsEnc,
    status: 'connected',
    enabled: true,
    updated_at: new Date().toISOString(),
  }
  if (opts.markConnectedNow) {
    update.connected_at = new Date().toISOString()
  }
  const { error } = await supabase
    .from('tenant_integrations')
    .update(update)
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
  if (error) throw new Error(`writeTokens failed: ${error.message}`)
}

export type MarkExpiredResult = { kind: 'marked' } | { kind: 'lost_race' }

/**
 * Marca a linha como `status='token_expired'` sem apagar credentials.
 * Permite reconexão rápida (admin clica Reconectar) sem precisar inserir
 * uma nova linha.
 *
 * Quando `expectedUpdatedAt` é fornecido, faz CAS — se outro worker
 * persistiu um refresh bem-sucedido no meio tempo (updated_at mudou),
 * retorna `lost_race` SEM sobrescrever. Caller deve então re-ler e
 * NÃO emitir audit/alert de expiração.
 *
 * Sem `expectedUpdatedAt`, mantém comportamento legado (UPDATE direto).
 */
export async function markTokenExpired(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: { expectedUpdatedAt?: string } = {},
): Promise<MarkExpiredResult> {
  const update = supabase
    .from('tenant_integrations')
    .update({ status: 'token_expired', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')

  if (opts.expectedUpdatedAt !== undefined) {
    const { data, error } = await update
      .eq('updated_at', opts.expectedUpdatedAt)
      .select('updated_at')
    if (error) throw new Error(`markTokenExpired failed: ${error.message}`)
    if (!data || data.length === 0) {
      return { kind: 'lost_race' }
    }
    return { kind: 'marked' }
  }

  const { error } = await update
  if (error) throw new Error(`markTokenExpired failed: ${error.message}`)
  return { kind: 'marked' }
}

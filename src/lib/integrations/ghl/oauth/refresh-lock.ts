import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { encryptCredentials } from '@/lib/core/integrations/credentials'
import type { GhlOAuthCredentials } from './types'

/**
 * Feature 008 — coordenação de refresh concorrente.
 *
 * Plano original (research item 2) previa `pg_advisory_xact_lock` para
 * serializar refreshes. Em pgBouncer transaction-mode (config padrão do
 * Supabase) advisory locks de transação são liberados ao COMMIT da
 * statement isolada — não dá pra estendê-los pela duração do HTTP call
 * ao GHL sem RPCs ad-hoc. Trocamos por **CAS sobre `updated_at`**:
 *
 * 1. Worker A lê row com `updated_at = T0` e detecta que precisa refrescar.
 * 2. Worker A chama GHL `/oauth/token`, recebe novo par.
 * 3. Worker A faz `UPDATE ... SET credentials_enc=novo, updated_at=now()
 *    WHERE updated_at = T0` (CAS).
 * 4. Se outro worker já persistiu antes (rowcount=0), Worker A descarta os
 *    novos tokens (que estão válidos no GHL) — próxima chamada lê a row
 *    fresca e usa os tokens persistidos.
 *
 * Trade-off aceitável: em raras corridas paralelas (refresh ~1x/dia por
 * tenant), pode haver 2 chamadas a `/oauth/token`. GHL aceita isso —
 * pior caso, um dos refresh_tokens é invalidado mas o persistido funciona.
 * Sem token corruption porque só uma escrita ganha (CAS atômico).
 */

export interface CommitRefreshedTokensInput {
  tenantId: string
  /** Snapshot do `updated_at` lido junto com a row antes do refresh. */
  expectedUpdatedAt: string
  newCredentials: GhlOAuthCredentials
}

export type CommitResult = { kind: 'committed' } | { kind: 'lost_race' }

/**
 * UPDATE compare-and-swap. Devolve `lost_race` se outro worker já
 * persistiu um refresh nesse meio-tempo (caller relê e segue com o
 * token novo do banco). Caller MUST tratar `lost_race` como sucesso
 * silencioso.
 */
export async function commitRefreshedTokens(
  supabase: SupabaseClient<Database>,
  input: CommitRefreshedTokensInput,
): Promise<CommitResult> {
  const credsEnc = await encryptCredentials(supabase, input.newCredentials)
  const { data, error } = await supabase
    .from('tenant_integrations')
    .update({
      credentials_enc: credsEnc,
      status: 'connected',
      enabled: true,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', input.tenantId)
    .eq('provider', 'ghl')
    .eq('updated_at', input.expectedUpdatedAt)
    .select('updated_at')

  if (error) {
    throw new Error(`commitRefreshedTokens UPDATE failed: ${error.message}`)
  }
  if (!data || data.length === 0) {
    logger.info(
      { tenant_id: input.tenantId, expected_updated_at: input.expectedUpdatedAt },
      'ghl-oauth-refresh-lost-race',
    )
    return { kind: 'lost_race' }
  }
  return { kind: 'committed' }
}

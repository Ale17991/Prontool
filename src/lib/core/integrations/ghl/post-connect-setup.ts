import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'

/**
 * Feature 008 — orquestrador de setup pós-conexão.
 *
 * **STUB Phase 2 (T017)**: retorna imediatamente sem efeito. A versão
 * real entra em US3 (T036) chamando `customFieldsSetup` e `webhooksSetup`,
 * e em US5 (T054) acrescentando `customMenuSetup`. Mantemos o ponto de
 * extensão aqui para que `connectGhlTenant` (chamado tanto no callback
 * OAuth quanto no install Marketplace) já dispare a função final sem
 * precisar de mudança em US3/US5.
 *
 * Caller faz `void runPostConnectSetup(...)` (fire-and-forget) — erros
 * gravam em `integration_sync_log`, nunca propagam para a resposta HTTP.
 */
export async function runPostConnectSetup(
  _supabase: SupabaseClient<Database>,
  tenantId: string,
  _accessToken: string,
): Promise<{ warnings: string[] }> {
  logger.info(
    { tenant_id: tenantId },
    'post-connect-setup-noop-pending-us3',
  )
  return { warnings: [] }
}

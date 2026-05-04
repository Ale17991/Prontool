import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { redactDetailPii } from '@/lib/utils/mask-pii'

/**
 * Feature 008 — gravação em `integration_sync_log`. Tabela é append-only
 * com RLS recusando inserts de JWT do usuário, então estes helpers DEVEM
 * receber um service-role client (criado via `createSupabaseServiceClient`
 * pelos route handlers).
 *
 * `detail` é passado por `redactDetailPii` antes de gravar — CPF, telefone,
 * email e nomes são mascarados. `error_message` é truncado a 500 chars.
 */

export type SyncLogKind =
  | 'outbound_contact'
  | 'outbound_note'
  | 'outbound_update'
  | 'inbound_contact'
  | 'inbound_opportunity'
  | 'token_refresh'
  | 'custom_field_setup'
  | 'webhook_setup'
  | 'custom_menu_setup'
  | 'connect'
  | 'disconnect'

export interface RecordSyncSuccessInput {
  kind: SyncLogKind
  detail?: Record<string, unknown>
}

export interface RecordSyncFailureInput {
  kind: SyncLogKind
  errorCode: string
  errorMessage: string
  detail?: Record<string, unknown>
}

const PROVIDER = 'ghl' as const

export async function recordSyncSuccess(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: RecordSyncSuccessInput,
): Promise<void> {
  const { error } = await supabase.from('integration_sync_log').insert({
    tenant_id: tenantId,
    provider: PROVIDER,
    kind: input.kind,
    status: 'success',
    detail: input.detail ? (redactDetailPii(input.detail) as unknown as Json) : null,
  })
  if (error) {
    // Não propaga: sync_log é observabilidade. Mas registra para que
    // bug em log silencioso não passe despercebido.
    logger.error(
      { err: error.message, tenant_id: tenantId, kind: input.kind },
      'integration-sync-log-insert-failed-success-path',
    )
  }
}

export async function recordSyncFailure(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: RecordSyncFailureInput,
): Promise<void> {
  const { error } = await supabase.from('integration_sync_log').insert({
    tenant_id: tenantId,
    provider: PROVIDER,
    kind: input.kind,
    status: 'failure',
    error_code: input.errorCode.slice(0, 80),
    error_message: input.errorMessage.slice(0, 500),
    detail: input.detail ? (redactDetailPii(input.detail) as unknown as Json) : null,
  })
  if (error) {
    logger.error(
      { err: error.message, tenant_id: tenantId, kind: input.kind },
      'integration-sync-log-insert-failed-failure-path',
    )
  }
}

/**
 * Lê últimos N eventos para a UI/sync-log endpoint. Usa o supabase passado
 * (geralmente RLS-bound — usuário só vê do próprio tenant).
 */
export async function listRecentSyncLog(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  limit: number = 10,
): Promise<
  Array<{
    id: string
    occurred_at: string
    kind: string
    status: string
    error_code: string | null
    error_message: string | null
    detail: unknown
  }>
> {
  const { data, error } = await supabase
    .from('integration_sync_log')
    .select('id, occurred_at, kind, status, error_code, error_message, detail')
    .eq('tenant_id', tenantId)
    .eq('provider', PROVIDER)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listRecentSyncLog failed: ${error.message}`)
  return data ?? []
}

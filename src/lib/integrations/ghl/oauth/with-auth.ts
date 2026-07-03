import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { recordSimpleIntegrationEvent } from '@/lib/core/audit/integration-events'
import { recordSyncFailure } from '@/lib/core/integrations/ghl/sync-log'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import { RefreshError, refreshTokens } from './client'
import { commitRefreshedTokens } from './refresh-lock'
import { decryptCredentials } from '@/lib/core/integrations/credentials'
import {
  ghlOAuthCredentialsSchema,
  GHL_TOKEN_REFRESH_LEEWAY_MS,
  type GhlOAuthCredentials,
} from './types'
import { markTokenExpired } from './token-store'

/**
 * Feature 008 — Middleware único para obter um access_token GHL válido.
 *
 * Adapter chama `withGhlAuth(supabase, tenantId)` antes de cada request.
 * Implementa fast-path (token fresco) e refresh-path (token vencendo).
 * Em falha permanente de refresh, marca `status='token_expired'`,
 * registra audit + alerta + sync-log, e devolve `kind: 'token_expired'`
 * — caller NÃO bloqueia operação local.
 */

export type WithGhlAuthResult =
  | {
      kind: 'connected'
      accessToken: string
      locationId: string
      tokenJustRefreshed: boolean
    }
  | { kind: 'token_expired' }
  | { kind: 'not_connected' }

export async function withGhlAuth(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<WithGhlAuthResult> {
  const row = await getIntegrationConfig(supabase, tenantId, 'ghl')
  if (!row || !row.enabled) return { kind: 'not_connected' }
  // status pode ser 'connected' | 'disconnected' | 'token_expired'.
  // 'disconnected' implica enabled=false, então o branch acima já saiu.
  // 'token_expired' segue até admin reconectar.
  const status = (row as unknown as { status?: string }).status
  if (status === 'disconnected') return { kind: 'not_connected' }
  if (status === 'token_expired') return { kind: 'token_expired' }

  let creds: GhlOAuthCredentials
  try {
    creds = await decryptCredentials(supabase, row, ghlOAuthCredentialsSchema)
  } catch (err) {
    // Tenant em formato Feature 002 (operations_pat) tentando OAuth-direct.
    // Não é erro permanente — UI já pede Reconectar via banner. Caller
    // recebe sinal equivalente a token_expired (degrada outbound).
    logger.info(
      { tenant_id: tenantId, err: err instanceof Error ? err.message : String(err) },
      'ghl-with-auth-legacy-credentials',
    )
    return { kind: 'token_expired' }
  }

  const expiresAtMs = Date.parse(creds.expires_at)
  const now = Date.now()
  if (Number.isFinite(expiresAtMs) && expiresAtMs - now > GHL_TOKEN_REFRESH_LEEWAY_MS) {
    return {
      kind: 'connected',
      accessToken: creds.access_token,
      locationId: creds.location_id,
      tokenJustRefreshed: false,
    }
  }

  // Refresh path.
  const expectedUpdatedAt = (row as unknown as { updated_at: string }).updated_at
  return refreshAndPersist(supabase, tenantId, creds, expectedUpdatedAt)
}

async function refreshAndPersist(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  currentCreds: GhlOAuthCredentials,
  expectedUpdatedAt: string,
): Promise<WithGhlAuthResult> {
  let newCreds: GhlOAuthCredentials
  try {
    newCreds = await refreshTokens(currentCreds.refresh_token)
  } catch (err) {
    if (err instanceof RefreshError && !err.transient) {
      // Permanente — marcar token_expired e alertar.
      //
      // CAS: se outro worker conseguiu refresh nesse meio-tempo (race),
      // updated_at mudou e markTokenExpired retorna lost_race. Nesse caso
      // NÃO marcamos expirado nem alertamos — o outro worker já persistiu
      // tokens válidos. Re-lemos e devolvemos.
      const expireResult = await markTokenExpired(supabase, tenantId, {
        expectedUpdatedAt,
      })
      if (expireResult.kind === 'lost_race') {
        logger.info(
          { tenant_id: tenantId, expected_updated_at: expectedUpdatedAt },
          'ghl-mark-expired-lost-race',
        )
        const refreshedRow = await getIntegrationConfig(supabase, tenantId, 'ghl')
        if (!refreshedRow || !refreshedRow.enabled) return { kind: 'not_connected' }
        const refreshedStatus = (refreshedRow as unknown as { status?: string }).status
        if (refreshedStatus === 'token_expired') return { kind: 'token_expired' }
        try {
          const persisted = await decryptCredentials(
            supabase,
            refreshedRow,
            ghlOAuthCredentialsSchema,
          )
          return {
            kind: 'connected',
            accessToken: persisted.access_token,
            locationId: persisted.location_id,
            tokenJustRefreshed: false,
          }
        } catch {
          return { kind: 'token_expired' }
        }
      }
      try {
        await recordSimpleIntegrationEvent(supabase, {
          type: 'integration.refresh_failed',
          tenantId,
          provider: 'ghl',
          actorUserId: null,
          actorLabel: 'system:ghl_oauth_refresh',
          reason: 'refresh_token revoked or invalid',
          detail: { status: err.status, body_excerpt: err.bodyExcerpt },
        })
      } catch (auditErr) {
        logger.error({ err: auditErr, tenant_id: tenantId }, 'ghl-refresh-audit-failed')
      }
      try {
        await recordSyncFailure(supabase, tenantId, {
          kind: 'token_refresh',
          errorCode: 'REFRESH_PERMANENT',
          errorMessage: `GHL /oauth/token returned ${err.status}`,
          detail: { status: err.status },
        })
      } catch (logErr) {
        logger.error({ err: logErr, tenant_id: tenantId }, 'ghl-refresh-synclog-failed')
      }
      try {
        await dispatchAlert({
          tenantId,
          type: 'integration_sync_failed',
          subjectRef: { provider: 'ghl', kind: 'token_refresh' },
          detail: {
            provider: 'ghl',
            kind: 'token_refresh',
            error_code: 'REFRESH_PERMANENT',
            status: err.status,
          },
        })
      } catch (alertErr) {
        logger.error({ err: alertErr, tenant_id: tenantId }, 'ghl-refresh-alert-failed')
      }
      return { kind: 'token_expired' }
    }
    // Transient — não muda status; caller usa o (possivelmente vencido)
    // access_token e segue. Próxima call repete a tentativa.
    logger.warn(
      {
        tenant_id: tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'ghl-refresh-transient-failure',
    )
    return {
      kind: 'connected',
      accessToken: currentCreds.access_token,
      locationId: currentCreds.location_id,
      tokenJustRefreshed: false,
    }
  }

  // Sucesso → CAS. Em lost_race, apenas relê e devolve.
  const cas = await commitRefreshedTokens(supabase, {
    tenantId,
    expectedUpdatedAt,
    newCredentials: newCreds,
  })

  if (cas.kind === 'lost_race') {
    // Outro worker persistiu — relê e devolve.
    const refreshedRow = await getIntegrationConfig(supabase, tenantId, 'ghl')
    if (!refreshedRow || !refreshedRow.enabled) return { kind: 'not_connected' }
    const persisted = await decryptCredentials(supabase, refreshedRow, ghlOAuthCredentialsSchema)
    return {
      kind: 'connected',
      accessToken: persisted.access_token,
      locationId: persisted.location_id,
      tokenJustRefreshed: false,
    }
  }

  // Auditoria de sucesso (best-effort).
  try {
    await recordSimpleIntegrationEvent(supabase, {
      type: 'integration.refresh_success',
      tenantId,
      provider: 'ghl',
      actorUserId: null,
      actorLabel: 'system:ghl_oauth_refresh',
      reason: 'token refreshed before expiry',
      detail: { expires_at: newCreds.expires_at },
    })
  } catch (err) {
    logger.error({ err, tenant_id: tenantId }, 'ghl-refresh-audit-success-failed')
  }
  try {
    await recordSyncSuccessTokenRefresh(supabase, tenantId, newCreds.expires_at)
  } catch (err) {
    logger.error({ err, tenant_id: tenantId }, 'ghl-refresh-synclog-success-failed')
  }

  return {
    kind: 'connected',
    accessToken: newCreds.access_token,
    locationId: newCreds.location_id,
    tokenJustRefreshed: true,
  }
}

// Helper local para evitar import circular com sync-log (que importa nada
// daqui). recordSyncSuccess é simples o suficiente pra inline.
async function recordSyncSuccessTokenRefresh(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await supabase.from('integration_sync_log').insert({
    tenant_id: tenantId,
    provider: 'ghl',
    kind: 'token_refresh',
    status: 'success',
    detail: { expires_at: expiresAt },
  })
  if (error) throw new Error(`integration_sync_log insert failed: ${error.message}`)
}

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { logger } from '@/lib/observability/logger'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import { decryptCredentials } from '@/lib/core/integrations/credentials'
import { recordSimpleIntegrationEvent } from '@/lib/core/audit/integration-events'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { recordSyncFailure, recordSyncSuccess } from '@/lib/core/integrations/ghl/sync-log'
import { commitRefreshedTokens } from '@/lib/integrations/ghl/oauth/refresh-lock'
import {
  RefreshError,
  refreshTokens,
} from '@/lib/integrations/ghl/oauth/client'
import { markTokenExpired } from '@/lib/integrations/ghl/oauth/token-store'
import { ghlOAuthCredentialsSchema } from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — POST /api/oauth/ghl/refresh
 *
 * Internal-only: força um refresh imediato dos tokens sem esperar o
 * `withGhlAuth` lazy. Útil para diagnóstico (admin clica "Forçar
 * refresh agora" na UI). Caminho normal usa `withGhlAuth` no adapter.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const route = '/api/oauth/ghl/refresh'
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const row = await getIntegrationConfig(supabase, session.tenantId, 'ghl')
    if (!row) {
      return NextResponse.json(
        { error: { code: 'NOT_CONNECTED', message: 'Sem integração GHL ativa neste tenant.' } },
        { status: 404 },
      )
    }
    const expectedUpdatedAt = (row as unknown as { updated_at: string }).updated_at

    let creds
    try {
      creds = await decryptCredentials(supabase, row, ghlOAuthCredentialsSchema)
    } catch (err) {
      logger.warn(
        { tenant_id: session.tenantId, err: err instanceof Error ? err.message : String(err) },
        'ghl-oauth-refresh-legacy-credentials',
      )
      return NextResponse.json(
        {
          error: {
            code: 'LEGACY_CREDENTIALS',
            message: 'Credenciais em formato antigo — peça reconexão via Conectar.',
            will_require_reconnect: true,
          },
        },
        { status: 409 },
      )
    }

    let newCreds
    try {
      newCreds = await refreshTokens(creds.refresh_token)
    } catch (err) {
      const isPermanent = err instanceof RefreshError && !err.transient
      const status = err instanceof RefreshError ? err.status : 0
      if (isPermanent) {
        await markTokenExpired(supabase, session.tenantId)
        try {
          await recordSimpleIntegrationEvent(supabase, {
            type: 'integration.refresh_failed',
            tenantId: session.tenantId,
            provider: 'ghl',
            actorUserId: session.userId,
            actorLabel: 'admin',
            reason: 'manual refresh — refresh_token revoked or invalid',
            detail: { status, source: 'manual_refresh' },
          })
        } catch {}
        try {
          await recordSyncFailure(supabase, session.tenantId, {
            kind: 'token_refresh',
            errorCode: 'REFRESH_PERMANENT',
            errorMessage: `GHL /oauth/token returned ${status}`,
            detail: { source: 'manual_refresh' },
          })
        } catch {}
        try {
          await dispatchAlert({
            tenantId: session.tenantId,
            type: 'integration_sync_failed',
            subjectRef: { provider: 'ghl', kind: 'token_refresh' },
            detail: { provider: 'ghl', kind: 'token_refresh', error_code: 'REFRESH_PERMANENT' },
          })
        } catch {}
        return NextResponse.json(
          {
            error: {
              code: 'REFRESH_FAILED',
              message: 'Refresh token inválido ou revogado. Reconecte a integração.',
              will_require_reconnect: true,
            },
          },
          { status: 502 },
        )
      }
      // Transient
      return NextResponse.json(
        {
          error: {
            code: 'REFRESH_TRANSIENT',
            message: 'GHL temporariamente indisponível. Tente novamente em instantes.',
          },
        },
        { status: 502 },
      )
    }

    // Sucesso. CAS — em lost_race, outro worker já gravou; ainda assim
    // resposta é 200 (do ponto de vista do admin, refresh deu certo).
    await commitRefreshedTokens(supabase, {
      tenantId: session.tenantId,
      expectedUpdatedAt,
      newCredentials: newCreds,
    })
    try {
      await recordSimpleIntegrationEvent(supabase, {
        type: 'integration.refresh_success',
        tenantId: session.tenantId,
        provider: 'ghl',
        actorUserId: session.userId,
        actorLabel: 'admin',
        reason: 'manual refresh',
        detail: { source: 'manual_refresh', expires_at: newCreds.expires_at },
      })
    } catch {}
    try {
      await recordSyncSuccess(supabase, session.tenantId, {
        kind: 'token_refresh',
        detail: { source: 'manual_refresh', expires_at: newCreds.expires_at },
      })
    } catch {}

    return NextResponse.json({ ok: true, expires_at: newCreds.expires_at }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

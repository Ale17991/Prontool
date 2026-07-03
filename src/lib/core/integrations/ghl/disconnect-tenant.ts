import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { decryptCredentials } from '@/lib/core/integrations/credentials'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import { recordSimpleIntegrationEvent } from '@/lib/core/audit/integration-events'
import { recordSyncSuccess, recordSyncFailure } from './sync-log'
import {
  ghlOAuthCredentialsSchema,
  GHL_API_BASE,
  GHL_API_VERSION,
  type GhlConfigV2,
} from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — Único caminho de desconexão. Consumido por:
 *   - DELETE /api/configuracoes/integracoes/ghl (manual)
 *   - POST /api/webhooks/ghl/uninstall (marketplace)
 *
 * Faz best-effort cleanup na sub-account GHL (DELETE webhooks +
 * custom-menu) e marca a row como `enabled=false, status='disconnected'`.
 * Não apaga `credentials_enc` para preservar evidência.
 */

export type DisconnectSource = 'manual_disconnect' | 'marketplace_uninstall'

export interface DisconnectGhlTenantInput {
  supabase: SupabaseClient<Database>
  source: DisconnectSource
  actorUserId: string | null
  actorLabel: string
  tenantId: string
  reason?: string
  ip?: string | null
  userAgent?: string | null
}

export interface DisconnectGhlTenantResult {
  cleanupRemaining: Array<{
    kind: 'webhook' | 'custom_menu'
    id: string
    status: number | null
    reason: string
  }>
}

const PROVIDER = 'ghl' as const

const REMOTE_CLEANUP_TIMEOUT_MS = 5_000

export async function disconnectGhlTenant(
  input: DisconnectGhlTenantInput,
): Promise<DisconnectGhlTenantResult> {
  const supabase = input.supabase
  const row = await getIntegrationConfig(supabase, input.tenantId, PROVIDER)
  if (!row) {
    // Idempotente: marketplace pode mandar uninstall pra location desconhecida.
    return { cleanupRemaining: [] }
  }

  const cleanupRemaining: DisconnectGhlTenantResult['cleanupRemaining'] = []

  // Cleanup remoto best-effort. Só roda se ainda temos OAuth válido pra usar.
  let accessToken: string | null = null
  try {
    const creds = await decryptCredentials(supabase, row, ghlOAuthCredentialsSchema)
    accessToken = creds.access_token
  } catch {
    // Tenant em formato legacy ou sem credentials válidas — pulamos cleanup.
  }

  const config = (row.config ?? {}) as Partial<GhlConfigV2>
  const webhookIds = config.webhook_ids ?? {}
  const menuId = config.menu_id ?? null

  if (accessToken) {
    for (const [event, hookId] of Object.entries(webhookIds)) {
      if (!hookId || typeof hookId !== 'string') continue
      const result = await deleteRemote(accessToken, `${GHL_API_BASE}/hooks/${hookId}`)
      if (!result.ok) {
        cleanupRemaining.push({
          kind: 'webhook',
          id: hookId,
          status: result.status,
          reason: `${event}:${result.reason}`,
        })
      }
    }
    if (menuId) {
      const result = await deleteRemote(accessToken, `${GHL_API_BASE}/custom-menus/${menuId}`)
      if (!result.ok) {
        cleanupRemaining.push({
          kind: 'custom_menu',
          id: menuId,
          status: result.status,
          reason: result.reason,
        })
      }
    }
  } else {
    // Sem token: registramos como pendência mas seguimos com a desconexão.
    for (const [event, hookId] of Object.entries(webhookIds)) {
      if (!hookId || typeof hookId !== 'string') continue
      cleanupRemaining.push({
        kind: 'webhook',
        id: hookId,
        status: null,
        reason: `${event}:no_access_token`,
      })
    }
    if (menuId) {
      cleanupRemaining.push({
        kind: 'custom_menu',
        id: menuId,
        status: null,
        reason: 'no_access_token',
      })
    }
  }

  // Marca a row desconectada (não apaga credentials_enc — preserva audit trail).
  const { error: updErr } = await supabase
    .from('tenant_integrations')
    .update({
      enabled: false,
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', input.tenantId)
    .eq('provider', PROVIDER)
  if (updErr) {
    throw new Error(`disconnectGhlTenant update failed: ${updErr.message}`)
  }

  // Audit + sync log
  try {
    await recordSimpleIntegrationEvent(supabase, {
      type: 'integration.disconnect',
      tenantId: input.tenantId,
      provider: PROVIDER,
      actorUserId: input.actorUserId,
      actorLabel: input.actorLabel,
      reason:
        input.source === 'marketplace_uninstall'
          ? 'GHL Marketplace uninstall webhook'
          : 'admin clicked Desconectar',
      detail: {
        source: input.source,
        manual_reason: input.reason ?? null,
        cleanup_remaining_count: cleanupRemaining.length,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    })
  } catch (err) {
    logger.error({ err, tenant_id: input.tenantId }, 'disconnect-tenant-audit-failed')
  }

  if (cleanupRemaining.length === 0) {
    await recordSyncSuccess(supabase, input.tenantId, {
      kind: 'disconnect',
      detail: { source: input.source },
    })
  } else {
    await recordSyncFailure(supabase, input.tenantId, {
      kind: 'disconnect',
      errorCode: 'PARTIAL_CLEANUP',
      errorMessage: `${cleanupRemaining.length} cleanup item(s) failed`,
      detail: { source: input.source, cleanup_remaining: cleanupRemaining },
    })
  }

  return { cleanupRemaining }
}

async function deleteRemote(
  accessToken: string,
  url: string,
): Promise<{ ok: boolean; status: number | null; reason: string }> {
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REMOTE_CLEANUP_TIMEOUT_MS),
    })
    if (res.ok || res.status === 404) {
      return { ok: true, status: res.status, reason: 'ok' }
    }
    return { ok: false, status: res.status, reason: `http_${res.status}` }
  } catch (err) {
    return {
      ok: false,
      status: null,
      reason: err instanceof Error ? err.message : 'unknown_error',
    }
  }
}

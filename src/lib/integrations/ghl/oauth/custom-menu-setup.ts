import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { recordSyncSuccess, recordSyncFailure } from '@/lib/core/integrations/ghl/sync-log'
import { updateGhlConfig } from '@/lib/core/integrations/ghl/config-update'
import { GHL_API_BASE, GHL_API_VERSION, type GhlConfigV2 } from './types'

/**
 * Feature 008 — Setup pós-conexão de Custom Menu (US5).
 *
 * Best-effort: tenta `POST /custom-menus/`. Se a API retornar 404/403/405
 * (recurso indisponível ou escopo ausente), grava `menu_status='unsupported'`
 * e segue. NUNCA bloqueia a conexão.
 *
 * STATUS: needs-verification-against-official-docs — endpoint exato e
 * escopo necessário podem mudar. Implementação atual é defensiva contra
 * todas as variações conhecidas.
 */

const REQUEST_TIMEOUT_MS = 5_000

export interface CustomMenuSetupResult {
  status: GhlConfigV2['menu_status']
  menuId: string | null
}

export async function customMenuSetup(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  accessToken: string,
  locationId: string,
  clinniBaseUrl: string,
): Promise<CustomMenuSetupResult> {
  const ssoUrl = `${clinniBaseUrl.replace(/\/$/, '')}/api/sso/ghl`

  let res: Response
  try {
    res = await fetch(`${GHL_API_BASE}/custom-menus/`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        locationId,
        title: 'Clinni',
        url: ssoUrl,
        icon: 'plug',
        showOnCompany: false,
        showOnLocation: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ tenant_id: tenantId, err: message }, 'ghl-custom-menu-network-error')
    await recordSyncFailure(supabase, tenantId, {
      kind: 'custom_menu_setup',
      errorCode: 'NETWORK_ERROR',
      errorMessage: message,
    })
    await updateGhlConfig(supabase, tenantId, { menu_status: 'failed' })
    return { status: 'failed', menuId: null }
  }

  if (res.ok) {
    const body = (await res.json().catch(() => null)) as {
      id?: string
      menu?: { id?: string }
    } | null
    const menuId = body?.id ?? body?.menu?.id ?? null
    await updateGhlConfig(supabase, tenantId, {
      menu_status: 'registered',
      menu_id: menuId,
    })
    await recordSyncSuccess(supabase, tenantId, {
      kind: 'custom_menu_setup',
      detail: { menu_id: menuId },
    })
    return { status: 'registered', menuId }
  }

  // 404/403/405 → recurso indisponível — não falha conexão.
  if (res.status === 404 || res.status === 403 || res.status === 405) {
    logger.info({ tenant_id: tenantId, status: res.status }, 'ghl-custom-menu-unsupported')
    await updateGhlConfig(supabase, tenantId, { menu_status: 'unsupported' })
    await recordSyncFailure(supabase, tenantId, {
      kind: 'custom_menu_setup',
      errorCode: 'UNSUPPORTED',
      errorMessage: `GHL custom-menus endpoint returned ${res.status}`,
    })
    return { status: 'unsupported', menuId: null }
  }

  // 5xx ou outros 4xx → failed.
  const text = await res.text().catch(() => '')
  logger.warn(
    { tenant_id: tenantId, status: res.status, body: text.slice(0, 200) },
    'ghl-custom-menu-failed',
  )
  await updateGhlConfig(supabase, tenantId, { menu_status: 'failed' })
  await recordSyncFailure(supabase, tenantId, {
    kind: 'custom_menu_setup',
    errorCode: `HTTP_${res.status}`,
    errorMessage: text.slice(0, 200),
  })
  return { status: 'failed', menuId: null }
}

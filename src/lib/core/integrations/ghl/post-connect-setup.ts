import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { customFieldsSetup } from '@/lib/integrations/ghl/oauth/custom-fields-setup'
import { webhooksSetup } from '@/lib/integrations/ghl/oauth/webhooks-setup'
import { customMenuSetup } from '@/lib/integrations/ghl/oauth/custom-menu-setup'
import { getIntegrationConfig } from '@/lib/core/integrations/config'

/**
 * Feature 008 — orquestrador de setup pós-conexão.
 *
 * Chamado por `connectGhlTenant` após persistir os tokens (em
 * fire-and-forget em produção, awaited em testes). Roda em sequência:
 *   1. customFieldsSetup  — cria/reusa os 6 custom fields.
 *   2. webhooksSetup      — registra ContactCreate/ContactUpdate/Opportunity.
 *   3. customMenuSetup    — best-effort (US5 / T054).
 *
 * Cada passo é isolado: erro num passo não impede os outros.
 * Cada operação grava sucesso/falha em `integration_sync_log`.
 */

export async function runPostConnectSetup(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  accessToken: string,
): Promise<{ warnings: string[] }> {
  const allWarnings: string[] = []

  // Carrega location_id da config recém-persistida.
  const row = await getIntegrationConfig(supabase, tenantId, 'ghl')
  if (!row) {
    logger.error({ tenant_id: tenantId }, 'post-connect-setup-row-missing')
    return { warnings: ['row_missing_after_connect'] }
  }
  const config = (row.config ?? {}) as { location_id?: string }
  const locationId = config.location_id
  if (!locationId) {
    logger.error({ tenant_id: tenantId }, 'post-connect-setup-no-location-id')
    return { warnings: ['no_location_id'] }
  }

  // 1. Custom fields.
  try {
    const cf = await customFieldsSetup(supabase, tenantId, accessToken, locationId)
    allWarnings.push(...cf.warnings)
  } catch (err) {
    logger.error(
      { tenant_id: tenantId, err: err instanceof Error ? err.message : String(err) },
      'post-connect-custom-fields-failed',
    )
    allWarnings.push('custom_fields_setup_failed')
  }

  // 2. Webhooks de contato.
  const baseUrl = readProntoolBaseUrl()
  if (baseUrl) {
    try {
      const wh = await webhooksSetup(supabase, tenantId, accessToken, locationId, baseUrl)
      allWarnings.push(...wh.warnings)
    } catch (err) {
      logger.error(
        { tenant_id: tenantId, err: err instanceof Error ? err.message : String(err) },
        'post-connect-webhooks-failed',
      )
      allWarnings.push('webhooks_setup_failed')
    }
  } else {
    logger.warn(
      { tenant_id: tenantId },
      'post-connect-webhooks-skipped-no-base-url',
    )
    allWarnings.push('webhooks_setup_skipped_no_base_url')
  }

  // 3. Custom Menu (US5) — best-effort, fallback gracioso. NUNCA bloqueia.
  if (baseUrl) {
    try {
      const menu = await customMenuSetup(
        supabase,
        tenantId,
        accessToken,
        locationId,
        baseUrl,
      )
      if (menu.status === 'unsupported') allWarnings.push('custom_menu_unsupported')
      if (menu.status === 'failed') allWarnings.push('custom_menu_failed')
    } catch (err) {
      logger.error(
        { tenant_id: tenantId, err: err instanceof Error ? err.message : String(err) },
        'post-connect-custom-menu-failed',
      )
      allWarnings.push('custom_menu_setup_failed')
    }
  }

  return { warnings: allWarnings }
}

function readProntoolBaseUrl(): string | null {
  // NEXT_PUBLIC_APP_URL é a fonte canônica do projeto.
  return process.env.NEXT_PUBLIC_APP_URL ?? null
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'
import { ghlConfigV2Schema, type GhlConfigV2 } from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — merge parcial sobre `tenant_integrations.config` para
 * o tenant×ghl. Usado pelos módulos de post-connect-setup
 * (`customFieldsSetup`, `webhooksSetup`, `customMenuSetup`) para gravar
 * os IDs sem reescrever o resto da config.
 *
 * Lê a config atual, faz merge raso (top-level), valida via Zod, persiste.
 * Caller deve passar service-role client.
 */
export async function updateGhlConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  partial: Partial<GhlConfigV2>,
): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from('tenant_integrations')
    .select('config')
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
    .single()
  if (readErr || !row) {
    throw new Error(
      `updateGhlConfig: row missing for tenant ${tenantId} (${readErr?.message ?? 'no row'})`,
    )
  }
  const current = (row.config ?? {}) as Record<string, unknown>
  const merged = ghlConfigV2Schema.parse({ ...current, ...partial })
  const { error: updErr } = await supabase
    .from('tenant_integrations')
    .update({ config: merged as unknown as Json })
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
  if (updErr) throw new Error(`updateGhlConfig update failed: ${updErr.message}`)
}

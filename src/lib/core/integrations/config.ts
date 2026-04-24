import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { ProviderId } from '@/lib/integrations/types'

export interface TenantIntegrationRow {
  tenant_id: string
  provider: ProviderId
  config: Record<string, unknown>
  credentials_enc: string
  webhook_secret_enc: string | null
  enabled: boolean
  created_at: string
  updated_at: string
  created_by_user_id: string
}

/**
 * Returns every enabled integration row for a tenant. Empty array ⇒ the
 * tenant is in standalone mode (FR-002: mode is derived from data).
 */
export async function getEnabledIntegrations(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<TenantIntegrationRow[]> {
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('enabled', true)
  if (error) {
    throw new Error(`getEnabledIntegrations failed: ${error.message}`)
  }
  return (data ?? []) as unknown as TenantIntegrationRow[]
}

/**
 * Returns a single tenant×provider config row (enabled or not), or null.
 * Used by webhook inbound routing (where disabled still counts as "this
 * provider was once connected") and by the provider detail page.
 */
export async function getIntegrationConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  provider: ProviderId,
): Promise<TenantIntegrationRow | null> {
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle()
  if (error) {
    throw new Error(`getIntegrationConfig failed: ${error.message}`)
  }
  return (data ?? null) as unknown as TenantIntegrationRow | null
}

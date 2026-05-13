import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError } from '@/lib/observability/errors'

/**
 * Feature 010 (US1) — Pre-flight da regra GHL 1:1.
 *
 * A constraint do banco (PK (tenant_id, provider) + UNIQUE INDEX parcial em
 * location_id WHERE provider='ghl' AND enabled=true, migration 0062) é a
 * rede de segurança final contra race condition. Esta função roda ANTES do
 * upsert para retornar mensagens específicas (FR-004) com o `code` certo.
 *
 * - `tenantId !== null` — tenant-side check (FR-001).
 * - sempre — location-side check (FR-002).
 *
 * O caller é responsável por chamar denyAudit/recordSimpleIntegrationEvent
 * em rejeição (a função apenas detecta + lança).
 */
export const GHL_TENANT_ALREADY_CONNECTED = 'GHL_TENANT_ALREADY_CONNECTED'
export const GHL_LOCATION_ALREADY_BOUND = 'GHL_LOCATION_ALREADY_BOUND'

export const FR001_MESSAGE =
  'Esta clínica já está conectada a outra conta Homio. Desconecte primeiro.'
export const FR002_MESSAGE =
  'Esta conta Homio já está vinculada a outra clínica no Prontool.'

export interface AssertGhlBindingFreeArgs {
  tenantId: string | null
  locationId: string
}

export async function assertGhlBindingFree(
  supabase: SupabaseClient<Database>,
  args: AssertGhlBindingFreeArgs,
): Promise<void> {
  const { tenantId, locationId } = args
  if (!locationId) {
    throw new Error('assertGhlBindingFree: locationId is required')
  }

  // (1) FR-001 — clínica já conectada?
  if (tenantId !== null) {
    const { data: existingTenant, error: tenantErr } = await supabase
      .from('tenant_integrations')
      .select('tenant_id, location_id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .eq('enabled', true)
      .maybeSingle()
    if (tenantErr && tenantErr.code !== 'PGRST116') {
      throw new Error(`assertGhlBindingFree tenant query failed: ${tenantErr.message}`)
    }
    if (existingTenant) {
      throw new ConflictError(GHL_TENANT_ALREADY_CONNECTED, FR001_MESSAGE, {
        tenant_id: tenantId,
        existing_location_id: existingTenant.location_id,
      })
    }
  }

  // (2) FR-002 — sub-account já vinculada?
  let locationQuery = supabase
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('provider', 'ghl')
    .eq('enabled', true)
    .eq('location_id', locationId)
  if (tenantId !== null) {
    locationQuery = locationQuery.neq('tenant_id', tenantId)
  }
  const { data: locationOwners, error: locErr } = await locationQuery
  if (locErr) {
    throw new Error(`assertGhlBindingFree location query failed: ${locErr.message}`)
  }
  if (locationOwners && locationOwners.length > 0) {
    throw new ConflictError(GHL_LOCATION_ALREADY_BOUND, FR002_MESSAGE, {
      location_id: locationId,
      // Nota: NÃO expomos o tenant atual (Princípio III — não vazar info
      // entre tenants). O caller decide o que mostrar para o usuário.
    })
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TenantRole } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'

/**
 * Feature 010 (US3) — lista clínicas ativas vinculadas ao usuário, com
 * metadados leves para o seletor (`/selecionar-clinica`) e o `dashboard-shell`
 * (decisão "mostrar botão Trocar clínica?").
 *
 * Por que SECURITY-DEFINER-equivalent (service-role): user_tenants tem RLS
 * que filtra por jwt_tenant_id, então um usuário com 2 clínicas e jwt
 * apontando pra uma só veria apenas uma. O caller precisa passar um
 * service-role client para conseguir listar todos os vínculos.
 *
 * `ghlConnected` consulta tenant_integrations com provider='ghl' AND
 * enabled=true. `lastUsedAt` vem de user_active_tenant.updated_at se existir.
 */
export interface AvailableTenant {
  tenantId: string
  name: string
  slug: string
  role: TenantRole
  ghlConnected: boolean
  lastUsedAt: string | null
}

export async function getAvailableTenants(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AvailableTenant[]> {
  const { data: links, error: linksErr } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, tenants!inner(id, name, slug, status)')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (linksErr) {
    logger.error({ err: linksErr.message, user_id: userId }, 'available-tenants-links-failed')
    throw new Error(`getAvailableTenants links failed: ${linksErr.message}`)
  }
  const rows = (links ?? []).filter((row) => {
    const tenant = (row as { tenants: { status: string } | null }).tenants
    return tenant != null && tenant.status === 'active'
  })
  if (rows.length === 0) return []

  const tenantIds = rows.map((row) => row.tenant_id)

  const [{ data: integrations, error: integrationsErr }, { data: lastUsed, error: lastUsedErr }] =
    await Promise.all([
      supabase
        .from('tenant_integrations')
        .select('tenant_id')
        .eq('provider', 'ghl')
        .eq('enabled', true)
        .in('tenant_id', tenantIds),
      supabase
        .from('user_active_tenant')
        .select('tenant_id, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ])
  if (integrationsErr) {
    logger.error(
      { err: integrationsErr.message, user_id: userId },
      'available-tenants-integrations-failed',
    )
  }
  if (lastUsedErr && lastUsedErr.code !== 'PGRST116') {
    logger.error(
      { err: lastUsedErr.message, user_id: userId },
      'available-tenants-last-used-failed',
    )
  }

  const ghlSet = new Set((integrations ?? []).map((it) => it.tenant_id))
  const lastTenantId = lastUsed?.tenant_id ?? null
  const lastTimestamp = lastUsed?.updated_at ?? null

  return rows.map((row) => {
    const tenant = (row as unknown as {
      tenants: { id: string; name: string; slug: string }
    }).tenants
    return {
      tenantId: row.tenant_id,
      name: tenant.name,
      slug: tenant.slug,
      role: row.role as TenantRole,
      ghlConnected: ghlSet.has(row.tenant_id),
      lastUsedAt: row.tenant_id === lastTenantId ? lastTimestamp : null,
    }
  })
}

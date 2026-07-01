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
  // Feature 031 — Admin-Agência enxerga as clínicas que pode acessar: super =
  // todas as ativas; suporte = só as atribuídas (platform_admin_tenants).
  // Detecta via platform_admins (requer service client).
  // platform_admins.is_super e platform_admin_tenants vêm da 0119 (tipos
  // regenerados depois) — cast nas consultas novas.
  const { data: pa } = await (supabase as any)
    .from('platform_admins')
    .select('user_id, is_super')
    .eq('user_id', userId)
    .maybeSingle()
  if (pa) {
    return getPlatformAdminTenants(supabase, userId, (pa as { is_super: boolean }).is_super)
  }

  // Selecionamos user_tenants.status explicitamente para filtrar em JS —
  // antes usávamos .eq('status', 'active') no PostgREST, mas como tanto
  // user_tenants quanto tenants têm coluna `status`, dependiam da forma
  // como PostgREST qualifica o WHERE. Filtrando em JS removemos toda
  // ambiguidade.
  const { data: links, error: linksErr } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, status, tenants!inner(id, name, slug, status)')
    .eq('user_id', userId)
  if (linksErr) {
    logger.error({ err: linksErr.message, user_id: userId }, 'available-tenants-links-failed')
    throw new Error(`getAvailableTenants links failed: ${linksErr.message}`)
  }
  // Normalize: Supabase às vezes retorna o embedded `tenants` como array
  // (relação ambígua, FK múltipla). Aqui só temos um FK
  // (user_tenants.tenant_id → tenants.id), mas tratamos defensivamente.
  interface PickedTenant {
    id: string
    name: string
    slug: string
    status: string
  }
  function pickTenant(row: unknown): PickedTenant | null {
    const t = (row as { tenants: unknown }).tenants
    if (t === null || t === undefined) return null
    if (Array.isArray(t)) return (t[0] as PickedTenant | undefined) ?? null
    return t as PickedTenant
  }
  const rows = (links ?? []).filter((row) => {
    const linkStatus = (row as { status: string }).status
    if (linkStatus !== 'active') return false
    const tenant = pickTenant(row)
    return tenant !== null && tenant.status === 'active'
  })
  logger.debug(
    {
      user_id: userId,
      total_links: links?.length ?? 0,
      active_after_filter: rows.length,
    },
    'available-tenants-resolved',
  )
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
    const tenant = pickTenant(row)!
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

/**
 * Feature 031 — clínicas acessíveis por um Admin-Agência (entra como `admin`).
 * Super → todas as ativas; suporte → só as atribuídas em platform_admin_tenants.
 */
async function getPlatformAdminTenants(
  supabase: SupabaseClient<Database>,
  userId: string,
  isSuper: boolean,
): Promise<AvailableTenant[]> {
  let scopedTenantIds: string[] | null = null
  if (!isSuper) {
    const { data: assigned } = await (supabase as any)
      .from('platform_admin_tenants')
      .select('tenant_id')
      .eq('user_id', userId)
    scopedTenantIds = ((assigned ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id)
    if (scopedTenantIds.length === 0) return []
  }

  let query = supabase.from('tenants').select('id, name, slug, status').eq('status', 'active')
  if (scopedTenantIds) query = query.in('id', scopedTenantIds)
  const { data: tlist, error: tErr } = await query.order('name', { ascending: true })
  if (tErr) {
    logger.error({ err: tErr.message, user_id: userId }, 'platform-admin-tenants-failed')
    return []
  }
  const rows = (tlist ?? []) as Array<{ id: string; name: string; slug: string; status: string }>
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const [{ data: integrations }, { data: lastUsed }] = await Promise.all([
    supabase
      .from('tenant_integrations')
      .select('tenant_id')
      .eq('provider', 'ghl')
      .eq('enabled', true)
      .in('tenant_id', ids),
    supabase
      .from('user_active_tenant')
      .select('tenant_id, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  const ghlSet = new Set((integrations ?? []).map((it) => it.tenant_id))
  const lastId = lastUsed?.tenant_id ?? null
  const lastTs = lastUsed?.updated_at ?? null

  return rows.map((t) => ({
    tenantId: t.id,
    name: t.name,
    slug: t.slug,
    role: 'admin' as TenantRole,
    ghlConnected: ghlSet.has(t.id),
    lastUsedAt: t.id === lastId ? lastTs : null,
  }))
}

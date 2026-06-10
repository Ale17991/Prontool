import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { AdminTenantsTable, type AdminTenantRow } from './tenants-table'
import { SupportAccess, type SupportUser } from './support-access'

export const dynamic = 'force-dynamic'

/**
 * Feature 031 — painel do admin GERAL: planos por clínica + acessos do
 * suporte. O layout já garantiu is_super; aqui usamos o service client
 * (cross-tenant, bypassa RLS).
 */
export default async function AdminPage() {
  const sb: any = createSupabaseServiceClient()

  const [tenantsRes, entRes, supportRes, assignRes, usersRes] = await Promise.all([
    sb.from('tenants').select('id, name, slug, status').order('name', { ascending: true }),
    sb.from('tenant_entitlements').select('tenant_id, plan, status, modules'),
    sb.from('platform_admins').select('user_id, is_super'),
    sb.from('platform_admin_tenants').select('user_id, tenant_id'),
    sb.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ])

  const entByTenant = new Map(
    ((entRes.data ?? []) as Array<{ tenant_id: string; plan: string; modules: string[] | null }>).map(
      (e) => [e.tenant_id, e],
    ),
  )
  const tenantRows = (
    (tenantsRes.data ?? []) as Array<{ id: string; name: string; slug: string; status: string }>
  ).map((t) => {
    const e = entByTenant.get(t.id)
    return {
      tenantId: t.id,
      name: t.name,
      slug: t.slug,
      tenantStatus: t.status,
      plan: (e?.plan as AdminTenantRow['plan']) ?? 'legacy',
      modules: e?.modules ?? [],
    } satisfies AdminTenantRow
  })

  // Usuários de suporte (platform admin não-super) + suas clínicas atribuídas.
  const emailById = new Map<string, string | null>(
    ((usersRes.data?.users ?? []) as Array<{ id: string; email: string | null }>).map((u) => [
      u.id,
      u.email ?? null,
    ]),
  )
  const assignsByUser = new Map<string, string[]>()
  for (const a of (assignRes.data ?? []) as Array<{ user_id: string; tenant_id: string }>) {
    assignsByUser.set(a.user_id, [...(assignsByUser.get(a.user_id) ?? []), a.tenant_id])
  }
  const supports: SupportUser[] = (
    (supportRes.data ?? []) as Array<{ user_id: string; is_super: boolean }>
  )
    .filter((p) => !p.is_super)
    .map((p) => ({
      userId: p.user_id,
      email: emailById.get(p.user_id) ?? p.user_id,
      assignedTenantIds: assignsByUser.get(p.user_id) ?? [],
    }))

  const tenantOptions = tenantRows.map((t) => ({ tenantId: t.tenantId, name: t.name, slug: t.slug }))

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Clínicas & planos</h2>
          <p className="text-sm text-slate-500">
            {tenantRows.length} clínica{tenantRows.length === 1 ? '' : 's'}. Defina plano, módulos
            ou entre na clínica.
          </p>
        </div>
        <AdminTenantsTable rows={tenantRows} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Acesso do suporte</h2>
          <p className="text-sm text-slate-500">
            Defina quais clínicas cada usuário de suporte pode acessar. (O usuário é criado no
            Supabase; aqui você atribui as clínicas.)
          </p>
        </div>
        <SupportAccess supports={supports} tenants={tenantOptions} />
      </section>
    </div>
  )
}

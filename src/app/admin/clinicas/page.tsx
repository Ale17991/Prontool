import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { ClinicsList, type ClinicListRow } from './clinics-list'
import { ALL_MODULES, buildEntitlements, type ModuleId, type Plan } from '@/lib/core/entitlements/plans'

export const dynamic = 'force-dynamic'

/** Feature 031 — Clínicas (admin geral). Lista rica + filtros → detalhe por clínica. */
export default async function AdminClinicasPage() {
  const sb: any = createSupabaseServiceClient()
  const [tenantsRes, entRes, userLinksRes, integrationsRes] = await Promise.all([
    sb.from('tenants').select('id, name, slug, status, created_at').order('name', { ascending: true }),
    sb.from('tenant_entitlements').select('tenant_id, plan, status, modules'),
    sb.from('user_tenants').select('tenant_id, status'),
    sb.from('tenant_integrations').select('tenant_id, provider'),
  ])

  const entByTenant = new Map(
    ((entRes.data ?? []) as Array<{ tenant_id: string; plan: string; status: string; modules: string[] | null }>).map(
      (e) => [e.tenant_id, e],
    ),
  )

  const usersByTenant = new Map<string, number>()
  for (const u of (userLinksRes.data ?? []) as Array<{ tenant_id: string; status: string }>) {
    if (u.status === 'disabled') continue
    usersByTenant.set(u.tenant_id, (usersByTenant.get(u.tenant_id) ?? 0) + 1)
  }

  const integrationsByTenant = new Map<string, string[]>()
  for (const i of (integrationsRes.data ?? []) as Array<{ tenant_id: string; provider: string }>) {
    const arr = integrationsByTenant.get(i.tenant_id) ?? []
    if (!arr.includes(i.provider)) arr.push(i.provider)
    integrationsByTenant.set(i.tenant_id, arr)
  }

  const rows: ClinicListRow[] = (
    (tenantsRes.data ?? []) as Array<{
      id: string
      name: string
      slug: string
      status: string
      created_at: string
    }>
  ).map((t) => {
    const ent = entByTenant.get(t.id)
    const plan = (ent?.plan as Plan) ?? 'legacy'
    const storedModules = (ent?.modules ?? []).filter((m): m is ModuleId =>
      (ALL_MODULES as readonly string[]).includes(m),
    )
    const effectiveModules = buildEntitlements(plan, storedModules).modules
    return {
      tenantId: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.created_at,
      plan,
      billingStatus: ent?.status ?? null,
      moduleCount: effectiveModules.length,
      userCount: usersByTenant.get(t.id) ?? 0,
      integrations: integrationsByTenant.get(t.id) ?? [],
    }
  })

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Clínicas</h2>
        <p className="mt-1 text-sm text-slate-500">
          Todas as clínicas da plataforma. Filtre, ordene e clique para abrir o painel da clínica
          (plano, módulos, usuários, pausar).
        </p>
      </div>
      <ClinicsList rows={rows} />
    </div>
  )
}

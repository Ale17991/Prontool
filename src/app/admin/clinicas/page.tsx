import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { AdminTenantsTable, type AdminTenantRow } from '../tenants-table'

export const dynamic = 'force-dynamic'

/** Feature 031 — Clínicas & planos (admin geral). */
export default async function AdminClinicasPage() {
  const sb: any = createSupabaseServiceClient()
  const [tenantsRes, entRes] = await Promise.all([
    sb.from('tenants').select('id, name, slug, status').order('name', { ascending: true }),
    sb.from('tenant_entitlements').select('tenant_id, plan, status, modules'),
  ])
  const entByTenant = new Map(
    ((entRes.data ?? []) as Array<{ tenant_id: string; plan: string; modules: string[] | null }>).map(
      (e) => [e.tenant_id, e],
    ),
  )
  const rows: AdminTenantRow[] = (
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
    }
  })

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Clínicas & planos</h2>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} clínica{rows.length === 1 ? '' : 's'}. Defina o plano e os módulos de cada
          uma (vale imediatamente) ou clique em <strong>Entrar</strong> para operar a clínica.
        </p>
      </div>
      <AdminTenantsTable rows={rows} />
    </div>
  )
}

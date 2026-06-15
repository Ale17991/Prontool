import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { ClinicsList, type ClinicListRow } from './clinics-list'
import type { Plan } from '@/lib/core/entitlements/plans'

export const dynamic = 'force-dynamic'

/** Feature 031 — Clínicas (admin geral). Lista pesquisável → detalhe por clínica. */
export default async function AdminClinicasPage() {
  const sb: any = createSupabaseServiceClient()
  const [tenantsRes, entRes] = await Promise.all([
    sb.from('tenants').select('id, name, slug, status').order('name', { ascending: true }),
    sb.from('tenant_entitlements').select('tenant_id, plan'),
  ])
  const planByTenant = new Map(
    ((entRes.data ?? []) as Array<{ tenant_id: string; plan: string }>).map((e) => [
      e.tenant_id,
      e.plan as Plan,
    ]),
  )
  const rows: ClinicListRow[] = (
    (tenantsRes.data ?? []) as Array<{ id: string; name: string; slug: string; status: string }>
  ).map((t) => ({
    tenantId: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    plan: planByTenant.get(t.id) ?? 'legacy',
  }))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Clínicas</h2>
        <p className="mt-1 text-sm text-slate-500">
          Busque uma clínica e clique para abrir — lá você define plano e módulos ou entra na
          clínica para dar suporte.
        </p>
      </div>
      <ClinicsList rows={rows} />
    </div>
  )
}

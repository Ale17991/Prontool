import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { ClinicDetail, type ClinicDetailRow } from './clinic-detail'
import type { Plan } from '@/lib/core/entitlements/plans'

export const dynamic = 'force-dynamic'

/** Feature 031 — detalhe de uma clínica: entrar + editar plano/módulos. */
export default async function AdminClinicaDetailPage({ params }: { params: { id: string } }) {
  const sb: any = createSupabaseServiceClient()
  const [tenantRes, entRes] = await Promise.all([
    sb.from('tenants').select('id, name, slug, status').eq('id', params.id).maybeSingle(),
    sb.from('tenant_entitlements').select('plan, modules').eq('tenant_id', params.id).maybeSingle(),
  ])
  const tenant = tenantRes.data as { id: string; name: string; slug: string; status: string } | null
  if (!tenant) notFound()

  const ent = entRes.data as { plan: string; modules: string[] | null } | null
  const row: ClinicDetailRow = {
    tenantId: tenant.id,
    name: tenant.name,
    plan: (ent?.plan as Plan) ?? 'legacy',
    modules: ent?.modules ?? [],
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/clinicas"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para clínicas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-black tracking-tight text-slate-900">{tenant.name}</h2>
          {tenant.status !== 'active' ? (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              {tenant.status}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">{tenant.slug}</p>
      </div>

      <ClinicDetail row={row} />
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTeamMembers } from '@/lib/core/team/list'
import { ClinicDetail, type ClinicDetailRow, type ClinicUserRow } from './clinic-detail'
import type { Plan } from '@/lib/core/entitlements/plans'

export const dynamic = 'force-dynamic'

/** Feature 031 — hub da clínica: visão geral, plano/módulos, usuários, ações. */
export default async function AdminClinicaDetailPage({ params }: { params: { id: string } }) {
  const sb: any = createSupabaseServiceClient()
  const id = params.id

  const [tenantRes, entRes, userCountRes, apptCountRes, lastActivityRes, integrationsRes, members] =
    await Promise.all([
      sb.from('tenants').select('id, name, slug, status').eq('id', id).maybeSingle(),
      sb.from('tenant_entitlements').select('plan, modules').eq('tenant_id', id).maybeSingle(),
      sb.from('user_tenants').select('user_id', { count: 'exact', head: true }).eq('tenant_id', id),
      sb.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', id),
      sb
        .from('audit_log')
        .select('created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from('tenant_integrations').select('provider, status').eq('tenant_id', id),
      listTeamMembers(createSupabaseServiceClient(), { tenantId: id, requesterId: '' }).catch(
        () => [],
      ),
    ])

  const tenant = tenantRes.data as { id: string; name: string; slug: string; status: string } | null
  if (!tenant) notFound()

  const ent = entRes.data as { plan: string; modules: string[] | null } | null
  const row: ClinicDetailRow = {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status === 'suspended' ? 'suspended' : 'active',
    plan: (ent?.plan as Plan) ?? 'legacy',
    modules: ent?.modules ?? [],
  }

  const integrations = ((integrationsRes.data ?? []) as Array<{ provider: string; status: string | null }>)
    .map((i) => i.provider)

  const metrics = {
    userCount: (userCountRes.count as number | null) ?? 0,
    appointmentCount: (apptCountRes.count as number | null) ?? 0,
    lastActivity: (lastActivityRes.data as { created_at?: string } | null)?.created_at ?? null,
    integrations,
  }

  const users: ClinicUserRow[] = (members as Awaited<ReturnType<typeof listTeamMembers>>).map((m) => ({
    userId: m.userId,
    name: m.fullName || m.email,
    email: m.email,
    role: m.role,
    status: m.status,
  }))

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
      </div>

      <ClinicDetail row={row} metrics={metrics} users={users} />
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTeamMembers } from '@/lib/core/team/list'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { ClinicDataForm } from './clinic-data-form'
import {
  ClinicDetail,
  type AuditEntry,
  type BillingStatus,
  type ClinicDetailRow,
  type ClinicUserRow,
} from './clinic-detail'
import type { Plan } from '@/lib/core/entitlements/plans'

export const dynamic = 'force-dynamic'

/** Feature 031 — hub da clínica: visão geral, plano/módulos, usuários, ações. */
export default async function AdminClinicaDetailPage({ params }: { params: { id: string } }) {
  const sb: any = createSupabaseServiceClient()
  const id = params.id

  const [
    tenantRes,
    entRes,
    userCountRes,
    apptCountRes,
    lastActivityRes,
    integrationsRes,
    members,
    auditRes,
  ] = await Promise.all([
    sb.from('tenants').select('id, name, slug, status').eq('id', id).maybeSingle(),
    sb
      .from('tenant_entitlements')
      .select('plan, modules, status, trial_ends_at')
      .eq('tenant_id', id)
      .maybeSingle(),
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
    sb
      .from('audit_log')
      .select('actor_id, entity, field, old_value, new_value, reason, created_at')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const tenant = tenantRes.data as { id: string; name: string; slug: string; status: string } | null
  if (!tenant) notFound()

  const profile = await getClinicProfile(sb, id)

  const ent = entRes.data as {
    plan: string
    modules: string[] | null
    status: string | null
    trial_ends_at: string | null
  } | null
  const row: ClinicDetailRow = {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status === 'suspended' ? 'suspended' : 'active',
    plan: (ent?.plan as Plan) ?? 'legacy',
    modules: ent?.modules ?? [],
    billingStatus: (['trial', 'active', 'past_due', 'canceled'].includes(ent?.status ?? '')
      ? ent!.status
      : 'active') as BillingStatus,
    trialEndsAt: ent?.trial_ends_at ?? null,
  }

  const integrations = (
    (integrationsRes.data ?? []) as Array<{ provider: string; status: string | null }>
  ).map((i) => i.provider)

  const metrics = {
    userCount: (userCountRes.count as number | null) ?? 0,
    appointmentCount: (apptCountRes.count as number | null) ?? 0,
    lastActivity: (lastActivityRes.data as { created_at?: string } | null)?.created_at ?? null,
    integrations,
  }

  const memberList = members as Awaited<ReturnType<typeof listTeamMembers>>
  const users: ClinicUserRow[] = memberList.map((m) => ({
    userId: m.userId,
    name: m.fullName || m.email,
    email: m.email,
    role: m.role,
    status: m.status,
  }))

  // Feed de auditoria — resolve nome do ator pelos membros já carregados.
  const nameByUser = new Map(memberList.map((m) => [m.userId, m.fullName || m.email]))
  const audit: AuditEntry[] = (
    (auditRes.data ?? []) as Array<{
      actor_id: string | null
      entity: string
      field: string | null
      old_value: string | null
      new_value: string | null
      reason: string | null
      created_at: string
    }>
  ).map((a) => ({
    actorName: a.actor_id ? (nameByUser.get(a.actor_id) ?? 'Sistema/Agência') : 'Sistema',
    entity: a.entity,
    field: a.field,
    oldValue: a.old_value,
    newValue: a.new_value,
    reason: a.reason,
    createdAt: a.created_at,
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

      <ClinicDetail row={row} metrics={metrics} users={users} audit={audit} />

      <ClinicDataForm
        tenantId={tenant.id}
        initial={{
          displayName: profile.displayName ?? tenant.name,
          cnpj: profile.cnpj,
          phone: profile.phone,
          email: profile.email,
        }}
      />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-bold text-slate-900">Usuários da clínica</h3>
        <p className="mb-3 text-xs text-slate-500">
          Criar, convidar, trocar papel, ativar/desativar e resetar senha dos usuários desta
          clínica.
        </p>
        <Link
          href={{ pathname: '/admin/usuarios', query: { tenant: tenant.id } }}
          className="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Gerenciar usuários
        </Link>
      </div>
    </div>
  )
}

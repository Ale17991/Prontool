import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { SupportAccess, type SupportUser } from '../support-access'
import { AgencyTeam, type AgencyUser } from './agency-team'

export const dynamic = 'force-dynamic'

/** Feature 031 — Equipe da agência: criar admins/suporte + atribuir clínicas ao suporte. */
export default async function AdminSuportePage() {
  const sb: any = createSupabaseServiceClient()
  const server = createSupabaseServerClient()
  const [tenantsRes, supportRes, assignRes, usersRes, meRes] = await Promise.all([
    sb
      .from('tenants')
      .select('id, name, slug')
      .eq('status', 'active')
      .order('name', { ascending: true }),
    sb.from('platform_admins').select('user_id, is_super'),
    sb.from('platform_admin_tenants').select('user_id, tenant_id'),
    sb.auth.admin.listUsers({ page: 1, perPage: 200 }),
    server.auth.getUser(),
  ])
  const myId = meRes.data?.user?.id ?? null

  const emailById = new Map<string, string | null>(
    ((usersRes.data?.users ?? []) as Array<{ id: string; email: string | null }>).map((u) => [
      u.id,
      u.email ?? null,
    ]),
  )
  const admins = (supportRes.data ?? []) as Array<{ user_id: string; is_super: boolean }>

  // Equipe da agência: TODOS os platform admins (super + suporte).
  const agencyUsers: AgencyUser[] = admins.map((p) => ({
    userId: p.user_id,
    email: emailById.get(p.user_id) ?? p.user_id,
    isSuper: p.is_super,
    isSelf: p.user_id === myId,
  }))

  // Acesso por clínica: só usuários de suporte (super já acessa tudo).
  const assignsByUser = new Map<string, string[]>()
  for (const a of (assignRes.data ?? []) as Array<{ user_id: string; tenant_id: string }>) {
    assignsByUser.set(a.user_id, [...(assignsByUser.get(a.user_id) ?? []), a.tenant_id])
  }
  const supports: SupportUser[] = admins
    .filter((p) => !p.is_super)
    .map((p) => ({
      userId: p.user_id,
      email: emailById.get(p.user_id) ?? p.user_id,
      assignedTenantIds: assignsByUser.get(p.user_id) ?? [],
    }))
  const tenantOptions = (
    (tenantsRes.data ?? []) as Array<{ id: string; name: string; slug: string }>
  ).map((t) => ({ tenantId: t.id, name: t.name, slug: t.slug }))

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900">Equipe da agência</h2>
          <p className="mt-1 text-sm text-slate-500">
            Crie e gerencie os usuários da agência. <strong>Admin geral</strong> acessa e gerencia
            todas as clínicas; <strong>Suporte</strong> acessa só as clínicas atribuídas abaixo.
          </p>
        </div>
        <AgencyTeam users={agencyUsers} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Acesso do suporte por clínica</h2>
          <p className="mt-1 text-sm text-slate-500">
            Defina quais clínicas cada usuário de <strong>suporte</strong> pode acessar.
          </p>
        </div>
        <SupportAccess supports={supports} tenants={tenantOptions} />
      </section>
    </div>
  )
}

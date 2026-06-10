import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { SupportAccess, type SupportUser } from '../support-access'

export const dynamic = 'force-dynamic'

/** Feature 031 — Equipe de suporte: atribuir clínicas a cada usuário de suporte. */
export default async function AdminSuportePage() {
  const sb: any = createSupabaseServiceClient()
  const [tenantsRes, supportRes, assignRes, usersRes] = await Promise.all([
    sb.from('tenants').select('id, name, slug').eq('status', 'active').order('name', { ascending: true }),
    sb.from('platform_admins').select('user_id, is_super'),
    sb.from('platform_admin_tenants').select('user_id, tenant_id'),
    sb.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ])

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
  const supports: SupportUser[] = ((supportRes.data ?? []) as Array<{ user_id: string; is_super: boolean }>)
    .filter((p) => !p.is_super)
    .map((p) => ({
      userId: p.user_id,
      email: emailById.get(p.user_id) ?? p.user_id,
      assignedTenantIds: assignsByUser.get(p.user_id) ?? [],
    }))
  const tenantOptions = ((tenantsRes.data ?? []) as Array<{ id: string; name: string; slug: string }>).map(
    (t) => ({ tenantId: t.id, name: t.name, slug: t.slug }),
  )

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Equipe de suporte</h2>
        <p className="mt-1 text-sm text-slate-500">
          Defina quais clínicas cada usuário de suporte pode acessar. A conta de suporte é criada
          no Supabase (<code className="rounded bg-slate-100 px-1 text-xs">platform_admins</code>,{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">is_super=false</code>); aqui você
          libera as clínicas.
        </p>
      </div>
      <SupportAccess supports={supports} tenants={tenantOptions} />
    </div>
  )
}

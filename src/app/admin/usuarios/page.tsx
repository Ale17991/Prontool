import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTeamMembers } from '@/lib/core/team/list'
import type { TeamMember } from '@/lib/core/team/types'
import type { Database } from '@/lib/db/types'
import { UsersPanel } from './users-panel'

export const dynamic = 'force-dynamic'

/** Feature 031 — gestão cross-tenant dos usuários das clínicas (admin geral). */
export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: { tenant?: string }
}) {
  const sb: any = createSupabaseServiceClient()
  const { data: tlist } = await sb
    .from('tenants')
    .select('id, name, slug')
    .eq('status', 'active')
    .order('name', { ascending: true })
  const tenants = ((tlist ?? []) as Array<{ id: string; name: string; slug: string }>).map((t) => ({
    tenantId: t.id,
    name: t.name,
    slug: t.slug,
  }))
  const selected =
    searchParams.tenant && tenants.some((t) => t.tenantId === searchParams.tenant)
      ? searchParams.tenant
      : (tenants[0]?.tenantId ?? null)

  let members: TeamMember[] = []
  if (selected) {
    const server = createSupabaseServerClient()
    const { data: u } = await server.auth.getUser()
    members = await listTeamMembers(sb as SupabaseClient<Database>, {
      tenantId: selected,
      requesterId: u.user?.id ?? '',
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Usuários</h2>
        <p className="mt-1 text-sm text-slate-500">
          Escolha uma clínica para gerenciar seus usuários: papel, status, criar conta, convidar e
          resetar senha. Alterações são auditadas.
        </p>
      </div>
      <UsersPanel tenants={tenants} selectedTenantId={selected} members={members} />
    </div>
  )
}

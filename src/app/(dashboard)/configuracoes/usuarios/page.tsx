import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTeamMembers } from '@/lib/core/team/list'
import { UsersList } from './users-list'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/configuracoes/perfil')

  const supabase = createSupabaseServiceClient()
  const users = await listTeamMembers(supabase, {
    tenantId: session.tenantId,
    requesterId: session.userId,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Users className="h-6 w-6 text-primary" />
          Equipe
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Convide novos usuários, altere papéis e desative o acesso de quem saiu da equipe.
        </p>
      </div>

      <UsersList initial={users} />
    </div>
  )
}

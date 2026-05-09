import { redirect } from 'next/navigation'
import { UserCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getUserProfile } from '@/lib/core/user-profile/read'
import { UserProfileForm } from './user-profile-form'
import { ChangePasswordForm } from './change-password-form'

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const profile = await getUserProfile(supabase, session.userId, session.email)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <UserCircle className="h-6 w-6 text-primary" />
          Meu perfil
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Foto, nome de exibição, fuso horário e troca de senha.
        </p>
      </div>

      <UserProfileForm initial={profile} />

      <ChangePasswordForm />
    </div>
  )
}

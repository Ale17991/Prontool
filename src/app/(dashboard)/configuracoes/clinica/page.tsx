import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { ClinicProfileForm } from './clinic-profile-form'

export const dynamic = 'force-dynamic'

export default async function ClinicProfilePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/configuracoes/perfil')

  const supabase = createSupabaseServiceClient()
  const profile = await getClinicProfile(supabase, session.tenantId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Building2 className="h-6 w-6 text-primary" />
          Dados da clínica
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Logo, dados oficiais e responsável técnico — aparecem no cabeçalho dos PDFs (prontuário,
          anamnese, relatórios) e no topo da sidebar.
        </p>
      </div>

      <ClinicProfileForm initial={profile} />
    </div>
  )
}

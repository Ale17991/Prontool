import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import { getAdapter } from '@/lib/integrations/registry'
import type { Database } from '@/lib/db/types'
import { DashboardShell } from './_components/dashboard-shell'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { getUserProfile } from '@/lib/core/user-profile/read'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  // RLS-bound client: tenant_integrations SELECT policy is tenant-wide, so any
  // authenticated role can read their own rows. Standalone tenant ⇒ empty
  // array ⇒ sidebar badge renders null.
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const rows = await getEnabledIntegrations(supabase, session.tenantId)
  const integrations: Array<{ provider: string; label: string }> = []
  for (const r of rows) {
    const adapter = getAdapter(r.provider)
    if (adapter) integrations.push({ provider: adapter.provider, label: adapter.label })
  }

  // Feature 009 — logo + nome da clínica + avatar/nome do usuário para o
  // topo e rodapé da sidebar. RLS-bound; getX faz lazy insert que pode
  // falhar para certos contextos. Capturamos silenciosamente — sem dados,
  // a sidebar usa fallback (ícones + email).
  const [clinicProfile, userProfile] = await Promise.all([
    getClinicProfile(supabase, session.tenantId).catch(() => null),
    getUserProfile(supabase, session.userId, session.email ?? null).catch(() => null),
  ])

  return (
    <DashboardShell
      role={session.role}
      email={session.email ?? null}
      integrations={integrations}
      clinicLogoUrl={clinicProfile?.logo?.signedUrl ?? null}
      clinicName={clinicProfile?.corporateName ?? null}
      userAvatarUrl={userProfile?.avatar?.signedUrl ?? null}
      userFullName={userProfile?.fullName ?? null}
    >
      {children}
    </DashboardShell>
  )
}

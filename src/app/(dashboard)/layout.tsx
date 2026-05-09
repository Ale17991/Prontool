import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import { getAdapter } from '@/lib/integrations/registry'
import type { Database } from '@/lib/db/types'
import { DashboardShell } from './_components/dashboard-shell'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { getUserProfile } from '@/lib/core/user-profile/read'
import { getAvailableTenants } from '@/lib/auth/available-tenants'

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

  // Feature 009 — logo + nome/dados da clínica + avatar/nome do usuário.
  // Feature 010 (US3) — tenants.name (display name) e contagem de tenants
  // ativos (decisão "mostrar Trocar clínica?").
  const supabaseService = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const [clinicProfile, userProfile, availableTenants] = await Promise.all([
    getClinicProfile(supabase, session.tenantId).catch(() => null),
    getUserProfile(supabase, session.userId, session.email ?? null).catch(() => null),
    getAvailableTenants(supabaseService, session.userId).catch(() => []),
  ])

  // Feature 010 (R13) — tenants.name é a fonte primária do nome de exibição.
  // corporate_name fica para o PDF (linha legal abaixo) e raramente diverge.
  // getClinicProfile já carrega tenants.name em `displayName`.
  const tenantDisplayName =
    clinicProfile?.displayName ?? clinicProfile?.corporateName ?? null

  return (
    <DashboardShell
      role={session.role}
      email={session.email ?? null}
      integrations={integrations}
      clinicLogoUrl={clinicProfile?.logo?.signedUrl ?? null}
      clinicName={tenantDisplayName}
      isMultiTenant={availableTenants.length > 1}
      userAvatarUrl={userProfile?.avatar?.signedUrl ?? null}
      userFullName={userProfile?.fullName ?? null}
    >
      {children}
    </DashboardShell>
  )
}

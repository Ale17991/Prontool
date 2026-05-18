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
import { logger } from '@/lib/observability/logger'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  // RLS-bound client: tenant_integrations SELECT policy is tenant-wide, so any
  // authenticated role can read their own rows. Standalone tenant ⇒ empty
  // array ⇒ sidebar badge renders null.
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  // Defense in depth: layout NUNCA pode derrubar o dashboard inteiro com
  // 500. Cada prefetch tem fallback explícito — pior caso é sidebar sem
  // badge de integração, sem logo da clínica, sem nome, sem "trocar
  // clínica". A app continua navegável.
  const integrations: Array<{ provider: string; label: string }> = []
  try {
    const rows = await getEnabledIntegrations(supabase, session.tenantId)
    for (const r of rows) {
      const adapter = getAdapter(r.provider)
      if (adapter) integrations.push({ provider: adapter.provider, label: adapter.label })
    }
  } catch {
    // standalone fallback — tratado como tenant sem integração.
  }

  // Feature 009 — logo + nome/dados da clínica + avatar/nome do usuário.
  // Feature 010 (US3) — tenants.name (display name) e contagem de tenants
  // ativos (decisão "mostrar Trocar clínica?"). O service client pode
  // estourar no allowlist (ver supabase-service.ts) — se acontecer, cai
  // pra []: usuário não vê "trocar clínica" mas o dashboard funciona.
  //
  // IMPORTANTE: falhas aqui são silenciosas para o usuário (a única
  // consequência é o link "Trocar clínica" sumir), mas precisam aparecer
  // em observabilidade — caso contrário um service-role key ausente em
  // produção fica indistinguível de "usuário tem 1 tenant só".
  let availableTenants: Awaited<ReturnType<typeof getAvailableTenants>> = []
  try {
    const supabaseService = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
    try {
      availableTenants = await getAvailableTenants(supabaseService, session.userId)
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          user_id: session.userId,
          tenant_id: session.tenantId,
        },
        'dashboard-layout-available-tenants-failed',
      )
      availableTenants = []
    }
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        user_id: session.userId,
      },
      'dashboard-layout-service-client-failed',
    )
    availableTenants = []
  }

  const [clinicProfile, userProfile] = await Promise.all([
    getClinicProfile(supabase, session.tenantId).catch(() => null),
    getUserProfile(supabase, session.userId, session.email ?? null).catch(() => null),
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

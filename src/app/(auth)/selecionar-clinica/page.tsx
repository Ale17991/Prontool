import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getAvailableTenants } from '@/lib/auth/available-tenants'
import { isPlatformAdmin } from '@/lib/auth/platform-admin'
import { decodeJwtClaims } from '@/lib/auth/jwt-claims'
import type { Database } from '@/lib/db/types'
import { TenantSelectorList } from './tenant-selector-list'

export const dynamic = 'force-dynamic'

export default async function SelecionarClinicaPage() {
  const supabase = createSupabaseServerClient()
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ])
  if (!userData.user) redirect('/login')

  const supabaseService = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const platformAdmin = await isPlatformAdmin(userData.user.id)
  const tenants = await getAvailableTenants(supabaseService, userData.user.id)

  // Admin-Agência: sempre escolhe explicitamente (mesmo com 1) — o switch é
  // que concede o claim do tenant. Suporte sem clínicas vê um aviso.
  if (platformAdmin) {
    if (tenants.length === 0) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center">
          <div className="max-w-sm space-y-2">
            <h1 className="text-lg font-black text-slate-900">Sem clínicas atribuídas</h1>
            <p className="text-sm text-slate-500">
              Sua conta de suporte ainda não tem clínicas liberadas. Peça ao admin geral para
              atribuir acesso no painel.
            </p>
          </div>
        </main>
      )
    }
  } else {
    if (tenants.length === 0) redirect('/onboarding')
    if (tenants.length === 1) redirect('/operacao/atendimentos')
  }

  // Multi-tenant: claim atual do JWT determina o card destacado.
  const claims = sessionData.session?.access_token
    ? decodeJwtClaims(sessionData.session.access_token)
    : null
  const currentTenantId = claims?.app_metadata?.tenant_id ?? null

  return <TenantSelectorList tenants={tenants} currentTenantId={currentTenantId} />
}

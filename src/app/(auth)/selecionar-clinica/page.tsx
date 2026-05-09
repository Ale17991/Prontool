import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getAvailableTenants } from '@/lib/auth/available-tenants'
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
  const tenants = await getAvailableTenants(supabaseService, userData.user.id)

  if (tenants.length === 0) redirect('/onboarding')
  if (tenants.length === 1) {
    // Single-tenant: vai direto, mas faz UPSERT em user_active_tenant
    // pra pré-marcar (ajuda quando o user ganha um segundo vínculo).
    redirect('/operacao/atendimentos')
  }

  // Multi-tenant: claim atual do JWT determina o card destacado.
  const claims = sessionData.session?.access_token
    ? decodeJwtClaims(sessionData.session.access_token)
    : null
  const currentTenantId = claims?.app_metadata?.tenant_id ?? null

  return <TenantSelectorList tenants={tenants} currentTenantId={currentTenantId} />
}

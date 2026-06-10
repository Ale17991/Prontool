import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getAvailableTenants } from '@/lib/auth/available-tenants'
import { isPlatformAdmin } from '@/lib/auth/platform-admin'
import { OnboardingForm } from './onboarding-form'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect('/login')

  // Feature 031 — Admin-Agência não faz onboarding de clínica; vai ao seletor
  // (super = todas; suporte = atribuídas). Evita loop onboarding⇄seletor.
  if (await isPlatformAdmin(userData.user.id)) redirect('/selecionar-clinica')

  // Se já tem clínica ativa, dispensa onboarding e vai pro dashboard.
  const supabaseService = createSupabaseServiceClient()
  const tenants = await getAvailableTenants(supabaseService, userData.user.id)
  if (tenants.length > 0) redirect('/operacao/atendimentos')

  return <OnboardingForm initialName={getDefaultName(userData.user.email ?? null)} />
}

function getDefaultName(email: string | null): string {
  if (!email) return ''
  const local = email.split('@')[0] ?? ''
  if (!local) return ''
  return `Clínica de ${local.charAt(0).toUpperCase()}${local.slice(1)}`
}

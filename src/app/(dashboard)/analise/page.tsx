import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { listFeatureFlags } from '@/lib/feature-flags'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'

export default async function AnalisePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const flags = listFeatureFlags()
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (flags.relatorios && ent.has('relatorios') && can(session.role, 'report.read'))
    redirect('/analise/relatorios')
  if (flags.comissoes && ent.has('comissoes') && can(session.role, 'doctor.read'))
    redirect('/analise/comissoes')
  // Feature 014 — Auditoria mudou de casa: /analise/auditoria foi para
  // /configuracoes/auditoria. Só redireciona se o plano inclui auditoria.
  if (ent.has('auditoria') && can(session.role, 'audit.read')) redirect('/configuracoes/auditoria')
  redirect('/configuracoes')
}

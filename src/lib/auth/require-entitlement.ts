/**
 * Feature 031 — guards de entitlement para Server Components (páginas).
 *
 * Complementa o RBAC (`requireRole`/`can`): RBAC decide QUEM na clínica usa;
 * o entitlement decide SE o PLANO inclui o recurso. Páginas gated chamam um
 * destes no topo; sem direito ⇒ redirect para o hub com `?bloqueado=<x>`.
 */
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import type { Entitlements, Feature, ModuleId } from '@/lib/core/entitlements/plans'

async function loadEntitlements(): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
  ent: Entitlements
}> {
  const session = await getSession()
  if (!session) redirect('/login')
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  return { session, ent }
}

/** Exige uma feature do plano; redireciona se faltar. */
export async function requireFeature(feature: Feature) {
  const { session, ent } = await loadEntitlements()
  if (!ent.has(feature)) redirect(`/configuracoes?bloqueado=${feature}`)
  return { session, ent }
}

/** Exige um módulo add-on; redireciona se faltar. */
export async function requireModule(moduleId: ModuleId) {
  const { session, ent } = await loadEntitlements()
  if (!ent.hasModule(moduleId)) redirect(`/configuracoes?bloqueado=${moduleId}`)
  return { session, ent }
}

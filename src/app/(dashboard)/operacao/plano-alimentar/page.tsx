import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { PlanBuilderClient } from './plan-builder-client'

/**
 * Feature 047 US2 — Plano Alimentar (tela própria, gated por `dieta`).
 */
export const dynamic = 'force-dynamic'

export default async function PlanoAlimentarPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('dieta')) redirect('/operacao/atendimentos')

  const canWrite = session.role === 'admin' || session.role === 'profissional_saude'
  if (!canWrite) redirect('/operacao/atendimentos')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Plano Alimentar</h1>
        <p className="text-sm text-slate-500">
          Monte o cardápio do paciente — o total de energia e macros é somado ao vivo e comparado
          com a meta da avaliação nutricional.
        </p>
      </div>
      <PlanBuilderClient />
    </div>
  )
}

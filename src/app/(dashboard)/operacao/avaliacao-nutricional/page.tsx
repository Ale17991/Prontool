import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { NutritionAssessmentClient } from './assessment-client'

/**
 * Feature 046 — Avaliação Nutricional (tela própria, gated por `nutri_avaliacao`).
 */
export const dynamic = 'force-dynamic'

export default async function AvaliacaoNutricionalPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('nutri_avaliacao')) redirect('/operacao/atendimentos')

  const canWrite = session.role === 'admin' || session.role === 'profissional_saude'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Avaliação Nutricional</h1>
        <p className="text-sm text-slate-500">
          Composição corporal, gasto energético e metas — o cálculo alimenta a evolução do paciente.
        </p>
      </div>
      <NutritionAssessmentClient canWrite={canWrite} />
    </div>
  )
}

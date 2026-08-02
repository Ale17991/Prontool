import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { RotuloClient } from './rotulo-client'

/**
 * Feature 052 — Rótulo nutricional de produto, gated por `nutri_rotulo`.
 * Consultoria para quem VENDE comida: o rótulo é de um cliente da clínica, não
 * de um paciente.
 */
export const dynamic = 'force-dynamic'

export default async function RotuloNutricionalPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('nutri_rotulo')) redirect('/operacao/atendimentos')

  const canWrite = session.role === 'admin' || session.role === 'profissional_saude'
  if (!canWrite) redirect('/operacao/atendimentos')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Rótulo nutricional</h1>
        <p className="text-sm text-slate-500">
          Monte o preparo, informe o rendimento e a porção, e obtenha a tabela INFORMAÇÃO
          NUTRICIONAL conforme a IN 75/2020 e a RDC 429/2020.
        </p>
      </div>
      <RotuloClient />
    </div>
  )
}

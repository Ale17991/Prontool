import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { OdontoSpaceClient } from './odonto-space-client'

/**
 * Feature 039/041 — Odontologia como tela própria (gated por `odonto`).
 * Mesmo hub do prontuário (odontograma / plano / periograma), acessível pela
 * sidebar com seleção de paciente.
 */
export const dynamic = 'force-dynamic'

export default async function OdontoPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('odonto')) redirect('/operacao/atendimentos')

  const canWriteClinical =
    session.role === 'admin' || session.role === 'financeiro' || session.role === 'profissional_saude'
  const canWriteTreatment = canWriteClinical

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Odontologia</h1>
        <p className="text-sm text-slate-500">
          Odontograma, plano de tratamento e periograma — selecione o paciente.
        </p>
      </div>
      <OdontoSpaceClient canWriteClinical={canWriteClinical} canWriteTreatment={canWriteTreatment} />
    </div>
  )
}

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { RecordatorioClient } from './recordatorio-client'

/**
 * Feature 049 US3 — Recordatório alimentar (R24h), gated por `nutri_recordatorio`.
 */
export const dynamic = 'force-dynamic'

export default async function RecordatorioPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('nutri_recordatorio')) redirect('/operacao/atendimentos')

  const canWrite = session.role === 'admin' || session.role === 'profissional_saude'
  if (!canWrite) redirect('/operacao/atendimentos')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Recordatório alimentar (R24h)</h1>
        <p className="text-sm text-slate-500">
          Registre o que o paciente comeu num dia — energia, macros e micronutrientes são somados ao
          vivo e comparados com a recomendação (DRI).
        </p>
      </div>
      <RecordatorioClient />
    </div>
  )
}

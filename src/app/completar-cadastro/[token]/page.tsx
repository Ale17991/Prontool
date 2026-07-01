import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveIntakeToken } from '@/lib/core/patient-intake'
import { IntakeForm } from './intake-form'

export const dynamic = 'force-dynamic'

export default async function CompletarCadastroPage({ params }: { params: { token: string } }) {
  const supabase = createSupabaseServiceClient()
  const ctx = await resolveIntakeToken(supabase, params.token).catch(() => null)

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      {!ctx ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Link inválido ou expirado</h1>
          <p className="mt-2 text-sm text-slate-500">Peça um novo link de cadastro à clínica.</p>
        </div>
      ) : (
        <IntakeForm token={params.token} clinicName={ctx.clinicName} />
      )}
    </div>
  )
}

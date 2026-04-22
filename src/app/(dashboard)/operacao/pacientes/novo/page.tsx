import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NewPatientForm, type HealthPlanOption } from './new-patient-form'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['admin', 'recepcionista'])

export default async function NovoPacientePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!ALLOWED_ROLES.has(session.role)) redirect('/operacao/pacientes')

  const supabase = createSupabaseServiceClient()
  const plans = await supabase
    .from('health_plans')
    .select('id, name')
    .eq('tenant_id', session.tenantId)
    .eq('active', true)
    .order('name', { ascending: true })
  const healthPlans: HealthPlanOption[] = (plans.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/operacao/pacientes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar aos pacientes
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          Novo paciente
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          PII criptografada localmente. O contato é mirrorado para o GHL em melhor-esforço —
          se a integração estiver indisponível, o paciente é salvo mesmo assim e um alerta
          operacional é aberto.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dados do paciente</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPatientForm healthPlans={healthPlans} />
        </CardContent>
      </Card>
    </div>
  )
}

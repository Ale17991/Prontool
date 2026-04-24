import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listPatients } from '@/lib/core/patients/list'
import { NewAppointmentForm, type FormOption } from './new-appointment-form'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['admin', 'recepcionista'])

export default async function NovoAtendimentoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!ALLOWED_ROLES.has(session.role)) redirect('/operacao/atendimentos')

  const supabase = createSupabaseServerClient()
  const service = createSupabaseServiceClient()

  const [plansRes, doctorsRes, proceduresRes, patientsRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('doctors')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('procedures')
      .select('id, tuss_code')
      .order('tuss_code', { ascending: true }),
    listPatients(service, { tenantId: session.tenantId, pageSize: 100 }),
  ])

  const plans: FormOption[] = ((plansRes.data ?? []) as Array<{ id: string; name: string }>).map(
    (p) => ({ id: p.id, label: p.name }),
  )
  const doctors: FormOption[] = (
    (doctorsRes.data ?? []) as Array<{ id: string; full_name: string }>
  ).map((d) => ({ id: d.id, label: d.full_name }))
  const procedures: FormOption[] = (
    (proceduresRes.data ?? []) as Array<{ id: string; tuss_code: string }>
  ).map((p) => ({ id: p.id, label: p.tuss_code }))
  const patients: FormOption[] = patientsRes.items.map((p) => ({
    id: p.id,
    label: `${p.fullName} · CPF ${p.cpf}`,
  }))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/operacao/atendimentos"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar aos atendimentos
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          Novo atendimento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre um atendimento realizado manualmente. Valor preenchido automaticamente com
          base na tabela de preços vigente; edite se for necessário.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dados do atendimento</CardTitle>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm
            patients={patients}
            doctors={doctors}
            procedures={procedures}
            plans={plans}
          />
        </CardContent>
      </Card>
    </div>
  )
}

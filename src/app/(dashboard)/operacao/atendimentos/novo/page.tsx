import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listPatients } from '@/lib/core/patients/list'
import { NewAppointmentForm, type FormOption } from './new-appointment-form'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['admin', 'recepcionista'])

interface PageProps {
  searchParams: { at?: string }
}

export default async function NovoAtendimentoPage({ searchParams }: PageProps) {
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
      .select('id, tuss_code, display_name')
      .order('tuss_code', { ascending: true }),
    listPatients(service, { tenantId: session.tenantId, pageSize: 100 }),
  ])

  const plans: FormOption[] = ((plansRes.data ?? []) as Array<{ id: string; name: string }>).map(
    (p) => ({ id: p.id, label: p.name }),
  )
  const doctors: FormOption[] = (
    (doctorsRes.data ?? []) as Array<{ id: string; full_name: string }>
  ).map((d) => ({ id: d.id, label: d.full_name }))
  const procedures = (
    (proceduresRes.data ?? []) as Array<{
      id: string
      tuss_code: string
      display_name: string | null
    }>
  ).map((p) => ({
    id: p.id,
    tussCode: p.tuss_code,
    displayName: p.display_name,
  }))
  const patients: FormOption[] = patientsRes.items.map((p) => ({
    id: p.id,
    label: `${p.fullName} · CPF ${p.cpf}`,
  }))

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
          <Link href="/operacao/atendimentos">
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </Link>
        </Button>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">
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
            initialAppointmentAt={searchParams.at}
          />
        </CardContent>
      </Card>
    </div>
  )
}

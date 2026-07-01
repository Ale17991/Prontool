import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScheduleBlockForm, type DoctorOption } from './schedule-block-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { date?: string; doctor_id?: string }
}

export default async function BloquearHorarioPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Qualquer papel autenticado pode acessar; a API POST faz o gate final.
  const ALLOWED = ['admin', 'recepcionista', 'financeiro', 'profissional_saude']
  if (!ALLOWED.includes(session.role)) {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServerClient()
  const { data: doctorsRaw } = await supabase
    .from('doctors')
    .select('id, full_name, active')
    .eq('tenant_id', session.tenantId)
    .eq('active', true)
    .order('full_name', { ascending: true })

  const doctors: DoctorOption[] = (
    (doctorsRaw ?? []) as Array<{ id: string; full_name: string }>
  ).map((d) => ({ id: d.id, fullName: d.full_name }))

  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const defaultDate =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : `${yyyy}-${mm}-${dd}`

  return (
    <div className="space-y-6">
      <Link
        href="/operacao/atendimentos"
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-3 w-3" /> Voltar para a agenda
      </Link>

      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Bloquear horário</h1>
        <p className="mt-1 text-sm text-slate-500">
          Marque um período da agenda como indisponível: reunião, curso, férias, manutenção etc. O
          bloqueio é visual; ele não impede a criação de atendimentos no mesmo horário, mas avisa
          que existe sobreposição.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Detalhes do bloqueio</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleBlockForm
            doctors={doctors}
            defaultDate={defaultDate}
            defaultDoctorId={searchParams.doctor_id ?? null}
          />
        </CardContent>
      </Card>
    </div>
  )
}

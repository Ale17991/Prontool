import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Circle, History, Percent, Stethoscope } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBps, formatDate, formatDateTime } from '@/lib/utils'
import { EditDoctorName } from './edit-doctor-name'
import { NewCommissionForm } from './new-commission-form'

export const dynamic = 'force-dynamic'

interface DoctorRow {
  id: string
  full_name: string
  crm: string
  external_identifier: string | null
  role: string
  specialty: string | null
  council_name: string | null
  council_number: string | null
  active: boolean
  created_at: string
}

interface CommissionRow {
  id: string
  percentage_bps: number
  valid_from: string
  reason: string
  created_at: string
  created_by: string | null
}

export default async function DoctorDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: doctorRaw, error } = await supabase
    .from('doctors')
    .select(
      'id, full_name, crm, external_identifier, role, specialty, council_name, council_number, active, created_at',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const doctor = doctorRaw as DoctorRow | null
  if (!doctor) notFound()

  const { data: commissionsRaw } = await supabase
    .from('doctor_commission_history')
    .select('id, percentage_bps, valid_from, reason, created_at, created_by')
    .eq('doctor_id', params.id)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  const commissions = (commissionsRaw ?? []) as CommissionRow[]

  const today = new Date().toISOString().slice(0, 10)
  const currentCommission = commissions.find((c) => c.valid_from <= today) ?? null
  const futureCommissions = commissions.filter((c) => c.valid_from > today)

  const canWrite = can(session.role, 'doctor.write')

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes/profissionais"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para profissionais
        </Link>
      </div>

      <Card>
        <CardContent className="p-8">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary text-3xl font-black text-white shadow-xl">
              {doctor.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-900">
                    {doctor.full_name}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {doctor.role && doctor.role !== 'profissional' ? (
                      <span className="rounded bg-blue-50 px-2 py-0.5 font-bold text-blue-700">
                        {doctor.role}
                      </span>
                    ) : null}
                    {doctor.specialty ? (
                      <span className="text-slate-600">{doctor.specialty}</span>
                    ) : null}
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-600">
                      {doctor.council_name ?? 'CRM'}: {doctor.council_number ?? doctor.crm}
                    </span>
                    {doctor.external_identifier ? (
                      <span className="font-mono text-[11px] text-slate-400">
                        Homio: {doctor.external_identifier}
                      </span>
                    ) : null}
                    <span className="text-slate-500">
                      Cadastrado em {formatDate(doctor.created_at)}
                    </span>
                  </div>
                </div>
                {doctor.active ? (
                  <Badge variant="success">Ativo</Badge>
                ) : (
                  <Badge variant="secondary">Inativo</Badge>
                )}
              </div>
              {canWrite ? <EditDoctorName doctorId={doctor.id} currentName={doctor.full_name} /> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          label="Comissão vigente hoje"
          value={currentCommission ? formatBps(currentCommission.percentage_bps) : '—'}
          sub={
            currentCommission
              ? `desde ${formatDate(currentCommission.valid_from)}`
              : 'Nenhuma comissão com vigência atual'
          }
        />
        <SummaryCard
          label="Versões no histórico"
          value={commissions.length.toString()}
        />
        <SummaryCard
          label="Agendadas (futuras)"
          value={futureCommissions.length.toString()}
          accent={futureCommissions.length > 0}
        />
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nova comissão</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-slate-500">
              Cria uma nova linha append-only no histórico. Atendimentos já criados mantêm o
              percentual congelado no momento da criação — só atendimentos a partir da data
              de vigência usam o novo valor.
            </p>
            <NewCommissionForm doctorId={doctor.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Histórico de comissões
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {commissions.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma comissão registrada.</p>
          ) : (
            <div className="relative space-y-4 before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-200">
              {commissions.map((c) => {
                const isFuture = c.valid_from > today
                const isCurrent = currentCommission?.id === c.id
                return (
                  <div key={c.id} className="relative pl-12">
                    <div
                      className={
                        isCurrent
                          ? 'absolute left-0 top-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary bg-white text-primary shadow-sm'
                          : isFuture
                          ? 'absolute left-0 top-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-amber-400 bg-white text-amber-500 shadow-sm'
                          : 'absolute left-0 top-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-slate-400 shadow-sm'
                      }
                    >
                      {isCurrent ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </div>
                    <div
                      className={
                        isCurrent
                          ? 'rounded-2xl border border-blue-100 bg-white p-4 shadow-sm'
                          : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-lg font-black tracking-tight text-slate-900">
                            {formatBps(c.percentage_bps)}
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            vigente a partir de {formatDate(c.valid_from)}
                          </p>
                        </div>
                        {isCurrent ? (
                          <Badge variant="success">Atual</Badge>
                        ) : isFuture ? (
                          <Badge variant="warning">Futura</Badge>
                        ) : (
                          <Badge variant="secondary">Histórica</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{c.reason}</p>
                      <p className="mt-2 font-mono text-[10px] text-slate-400">
                        Criada em {formatDateTime(c.created_at)}
                        {c.created_by ? ` · por ${c.created_by.slice(0, 8)}` : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
          <Percent className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p
          className={
            accent
              ? 'text-xl font-black tracking-tight text-amber-600'
              : 'text-xl font-black tracking-tight text-slate-900'
          }
        >
          {value}
        </p>
        {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

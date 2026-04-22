import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  Mail,
  Paperclip,
  Phone,
  Receipt,
  ShieldAlert,
  Stethoscope,
  User,
} from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPatient } from '@/lib/core/patients/get'
import { listClinicalRecords } from '@/lib/core/clinical-records/list'
import { listTreatmentPlans } from '@/lib/core/treatment-plans/list'
import {
  TreatmentPlansSection,
  type HealthPlanOption,
  type ProcedureOption,
} from './treatment-plans-section'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { calculateAge, formatCurrency, formatDate, formatDateTime, formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { id: string }
}

interface AppointmentRow {
  id: string | null
  appointment_at: string | null
  frozen_amount_cents: number | null
  net_amount_cents: number | null
  effective_status: string | null
}

export default async function PacienteDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const serviceClient = createSupabaseServiceClient()
  let detail
  try {
    detail = await getPatient(serviceClient, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) notFound()
    throw err
  }
  const { patient, summary } = detail

  const serverClient = createSupabaseServerClient()
  const { data: appointmentsRaw } = await serverClient
    .from('appointments_effective')
    .select('id, appointment_at, frozen_amount_cents, net_amount_cents, effective_status')
    .eq('patient_id', params.id)
    .order('appointment_at', { ascending: false })
    .limit(50)
  const appointments = (appointmentsRaw ?? []) as AppointmentRow[]

  const records = await listClinicalRecords(serviceClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  })

  const treatmentPlans = await listTreatmentPlans(serviceClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  })

  const [proceduresRes, healthPlansRes] = await Promise.all([
    serviceClient
      .from('procedures')
      .select('id, tuss_code, display_name')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(500),
    serviceClient
      .from('health_plans')
      .select('id, name')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
  ])
  const procedures: ProcedureOption[] = (proceduresRes.data ?? []).map((p) => ({
    id: p.id,
    tussCode: p.tuss_code,
    displayName: p.display_name,
  }))
  const healthPlansList: HealthPlanOption[] = (healthPlansRes.data ?? []).map((hp) => ({
    id: hp.id,
    name: hp.name,
  }))

  const canWriteTreatment =
    session.role === 'admin' ||
    session.role === 'financeiro' ||
    session.role === 'profissional_saude'

  const isAnonymized = Boolean(patient.anonymizedAt)
  const initial = (patient.fullName || '?').charAt(0).toUpperCase()
  const age = calculateAge(patient.birthDate)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/operacao/pacientes"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para pacientes
        </Link>
      </div>

      {isAnonymized ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Paciente anonimizado por retenção LGPD</p>
            <p className="text-xs text-amber-800">
              Anonimizado em {formatDateTime(patient.anonymizedAt)}. Histórico financeiro
              permanece íntegro.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-8">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary text-3xl font-black text-white shadow-xl">
              {isAnonymized ? <User className="h-8 w-8" /> : initial}
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">
                  {isAnonymized ? '[anonimizado]' : patient.fullName || '—'}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-600">
                    CPF: {isAnonymized ? '—' : patient.cpf || '—'}
                  </span>
                  {patient.birthDate ? (
                    <span className="flex items-center gap-1 text-slate-500">
                      <Calendar className="h-3 w-3" />
                      {formatDate(patient.birthDate)}
                      {age !== null ? ` (${age} anos)` : ''}
                    </span>
                  ) : null}
                  <span className="font-mono text-[11px] text-slate-400">
                    GHL: {patient.ghlContactId}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
                <ContactChip icon={Phone} label="Telefone" value={patient.phone} color="emerald" />
                <ContactChip icon={Mail} label="Email" value={patient.email} color="blue" />
                <ContactChip
                  icon={Clock}
                  label="Cadastrado em"
                  value={formatDate(patient.createdAt)}
                  color="amber"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Atendimentos"
          value={summary.appointmentCount.toString()}
          sub={`${summary.activeAppointmentCount} ativo${summary.activeAppointmentCount === 1 ? '' : 's'}`}
        />
        <SummaryCard
          label="Estornados"
          value={summary.reversedAppointmentCount.toString()}
          accent={summary.reversedAppointmentCount > 0}
        />
        <SummaryCard
          label="Receita bruta"
          value={formatCurrency(summary.totalRevenueCents)}
        />
        <SummaryCard
          label="Receita líquida"
          value={formatCurrency(summary.netRevenueCents)}
          sub={
            summary.lastAppointmentAt
              ? `Último: ${formatDate(summary.lastAppointmentAt)}`
              : 'Sem atendimentos'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Stethoscope className="h-4 w-4 text-primary" />
            Histórico de atendimentos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {appointments.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              Nenhum atendimento registrado para este paciente.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Valor bruto</TableHead>
                  <TableHead>Valor líquido</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((a) => (
                  <TableRow key={a.id ?? Math.random()} className="group">
                    <TableCell className="text-slate-700">
                      {formatDateTime(a.appointment_at)}
                    </TableCell>
                    <TableCell className="font-semibold text-slate-900">
                      {formatCurrency(a.frozen_amount_cents)}
                    </TableCell>
                    <TableCell className="font-bold text-slate-900">
                      {formatCurrency(a.net_amount_cents)}
                    </TableCell>
                    <TableCell>
                      {a.effective_status === 'estornado' ? (
                        <Badge variant="destructive">Estornado</Badge>
                      ) : (
                        <Badge variant="success">Ativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.id ? (
                        <Link
                          href={`/operacao/atendimentos/${a.id}`}
                          className="text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          Abrir
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAnonymized ? null : (
        <TreatmentPlansSection
          patientId={params.id}
          initialPlans={treatmentPlans}
          procedures={procedures}
          healthPlans={healthPlansList}
          canWrite={canWriteTreatment}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            Ficha clínica
          </CardTitle>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum registro clínico ainda. Evoluções e documentos aparecerão aqui.
            </p>
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={
                          r.type === 'texto'
                            ? 'flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600'
                            : 'flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600'
                        }
                      >
                        {r.type === 'texto' ? (
                          <FileText className="h-4 w-4" />
                        ) : (
                          <Paperclip className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{r.title}</p>
                        <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                          {formatDateTime(r.createdAt)} · por {r.createdBy.slice(0, 8)}
                        </p>
                      </div>
                    </div>
                    {r.type === 'arquivo' ? (
                      <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                        {formatFileSize(r.fileSizeBytes)}
                      </span>
                    ) : null}
                  </div>
                  {r.type === 'texto' && r.content ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                      {r.content}
                    </p>
                  ) : null}
                  {r.type === 'arquivo' && r.fileName ? (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <FileText className="h-3 w-3 text-slate-400" />
                      <span className="font-mono">{r.fileName}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ContactChip({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Phone
  label: string
  value: string | null | undefined
  color: 'emerald' | 'blue' | 'amber'
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
  }
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[color]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className="text-sm font-bold text-slate-700">{value || 'Não informado'}</p>
      </div>
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
          <Receipt className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p
          className={
            accent
              ? 'text-xl font-black tracking-tight text-rose-600'
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

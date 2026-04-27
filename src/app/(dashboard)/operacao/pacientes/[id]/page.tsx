import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Mail,
  Phone,
  Receipt,
  ShieldAlert,
  Stethoscope,
  User,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { getPatient } from '@/lib/core/patients/get'
import { listClinicalRecords } from '@/lib/core/clinical-records/list'
import { listTreatmentSteps } from '@/lib/core/treatment-steps/list'
import type { Database } from '@/lib/db/types'
import {
  TreatmentStepsSection,
  type DoctorOption,
  type HealthPlanOption,
  type ProcedureOption,
} from './treatment-steps-section'
import { PatientPlanEditor } from './patient-plan-editor'
import { ClinicalRecordsSection } from './clinical-records-section'
import { AddressEditor } from './address-editor'
import { PatientCleanupButton } from './cleanup-button'
import { FinanceiroSection } from './financeiro-section'
import { listPaymentsForPatient } from '@/lib/core/payments/list'
import { DiagnosticsSection } from './diagnosticos-section'
import { MedicalHistorySection } from './medical-history-section'
import { VitalSignsSection } from './vital-signs-section'
import { PrintChartButton } from './print-chart-button'
import { listAllergies } from '@/lib/core/patient-medical/allergies'
import { listHistory } from '@/lib/core/patient-medical/history'
import { listVitalSigns } from '@/lib/core/patient-medical/vital-signs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { calculateAge, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'

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

  // RLS + RPCs SECURITY DEFINER com grant para authenticated cobrem tudo
  // que essa página lê. O cast abaixo alinha o tipo do @supabase/ssr com
  // o SupabaseClient<Database> esperado pelos core helpers.
  const supabase = createSupabaseServerClient()
  const typedClient = supabase as unknown as SupabaseClient<Database>
  let detail
  try {
    detail = await getPatient(typedClient, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) notFound()
    throw err
  }
  const { patient, summary } = detail

  const { data: appointmentsRaw } = await supabase
    .from('appointments_effective')
    .select('id, appointment_at, frozen_amount_cents, net_amount_cents, effective_status')
    .eq('patient_id', params.id)
    .order('appointment_at', { ascending: false })
    .limit(50)
  const appointments = (appointmentsRaw ?? []) as AppointmentRow[]

  const records = await listClinicalRecords(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  })

  const treatmentSteps = await listTreatmentSteps(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
    patientPlanId: patient.healthPlan?.id ?? null,
  })

  const payments = await listPaymentsForPatient(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  })

  const [allergies, medicalHistory, vitalSigns] = await Promise.all([
    listAllergies(typedClient, { tenantId: session.tenantId, patientId: params.id }),
    listHistory(typedClient, { tenantId: session.tenantId, patientId: params.id }),
    listVitalSigns(typedClient, { tenantId: session.tenantId, patientId: params.id }),
  ])

  const [proceduresRes, healthPlansRes, doctorsRes] = await Promise.all([
    supabase
      .from('procedures')
      .select('id, tuss_code, display_name, covered_by_plan, default_amount_cents')
      .eq('active', true)
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(500),
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('doctors')
      .select('id, full_name, role, specialty')
      .eq('active', true)
      .order('full_name', { ascending: true }),
  ])
  const procedures: ProcedureOption[] = (
    (proceduresRes.data ?? []) as Array<{
      id: string
      tuss_code: string
      display_name: string | null
      covered_by_plan: boolean
      default_amount_cents: number | null
    }>
  ).map((p) => ({
    id: p.id,
    tussCode: p.tuss_code,
    displayName: p.display_name,
    coveredByPlan: p.covered_by_plan,
    defaultAmountCents: p.default_amount_cents,
  }))
  const healthPlansList: HealthPlanOption[] = (
    (healthPlansRes.data ?? []) as Array<{ id: string; name: string }>
  ).map((hp) => ({
    id: hp.id,
    name: hp.name,
  }))
  const doctorsList: DoctorOption[] = (
    (doctorsRes.data ?? []) as Array<{
      id: string
      full_name: string
      role: string | null
      specialty: string | null
    }>
  ).map((d) => ({
    id: d.id,
    fullName: d.full_name,
    role: d.role,
    specialty: d.specialty,
  }))

  const canWriteTreatment =
    session.role === 'admin' ||
    session.role === 'financeiro' ||
    session.role === 'profissional_saude'

  const canEditPatient = session.role === 'admin' || session.role === 'recepcionista'
  const canWriteClinicalRecords =
    session.role === 'admin' ||
    session.role === 'financeiro' ||
    session.role === 'profissional_saude'
  // /api/anamnesis-templates/[id]/apply só aceita admin (route.ts:22). Se
  // expandirem o RBAC depois, este gate sobe junto.
  const canApplyAnamnesis = session.role === 'admin'

  const isAnonymized = Boolean(patient.anonymizedAt)
  const initial = (patient.fullName || '?').charAt(0).toUpperCase()
  const age = calculateAge(patient.birthDate)

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/operacao/pacientes"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para pacientes
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {!isAnonymized ? <PrintChartButton patientId={params.id} /> : null}
          {session.role === 'admin' && !isAnonymized ? (
            <PatientCleanupButton patientId={params.id} />
          ) : null}
        </div>
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
                  {patient.ghlContactId ? (
                    <span className="font-mono text-[11px] text-slate-400">
                      GHL: {patient.ghlContactId}
                    </span>
                  ) : null}
                </div>
                {isAnonymized ? null : (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Plano de saúde
                    </span>
                    <PatientPlanEditor
                      patientId={patient.id}
                      currentPlanId={patient.healthPlan?.id ?? null}
                      currentPlanName={patient.healthPlan?.name ?? null}
                      healthPlans={healthPlansList}
                      canEdit={canEditPatient}
                    />
                  </div>
                )}
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

      {isAnonymized ? null : (
        <AddressEditor
          patientId={params.id}
          address={patient.address}
          canEdit={canEditPatient}
        />
      )}

      {isAnonymized ? null : (
        <MedicalHistorySection
          patientId={params.id}
          initialAllergies={allergies}
          initialHistory={medicalHistory}
          canWrite={canWriteClinicalRecords}
        />
      )}

      {isAnonymized ? null : (
        <VitalSignsSection
          patientId={params.id}
          initial={vitalSigns}
          canWrite={
            session.role === 'admin' || session.role === 'profissional_saude'
          }
        />
      )}

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
        <TreatmentStepsSection
          patientId={params.id}
          patientPlanId={patient.healthPlan?.id ?? null}
          patientPlanName={patient.healthPlan?.name ?? null}
          initialSteps={treatmentSteps}
          procedures={procedures}
          healthPlans={healthPlansList}
          doctors={doctorsList}
          canWrite={canWriteTreatment}
        />
      )}

      {isAnonymized ? null : (
        <FinanceiroSection
          patientId={params.id}
          initialRecords={payments.records}
          initialSummary={payments.summary}
          canRecordPayment={
            session.role === 'admin' || session.role === 'financeiro'
          }
        />
      )}

      {isAnonymized ? null : <DiagnosticsSection records={records} />}

      <ClinicalRecordsSection
        patientId={params.id}
        patientName={isAnonymized ? '[anonimizado]' : patient.fullName || null}
        patientPrefill={
          isAnonymized
            ? undefined
            : {
                fullName: patient.fullName || null,
                cpf: patient.cpf || null,
                phone: patient.phone,
                email: patient.email,
                birthDate: patient.birthDate,
                healthPlanName: patient.healthPlan?.name ?? null,
                address: patient.address,
                allergies: allergies.map((a) => ({
                  substance: a.substance,
                  severity: a.severity,
                  notes: a.notes,
                })),
              }
        }
        initialRecords={records}
        canWrite={canWriteClinicalRecords && !isAnonymized}
        canApplyAnamnesis={canApplyAnamnesis && !isAnonymized}
        canDeleteAnamnese={session.role === 'admin' && !isAnonymized}
      />

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

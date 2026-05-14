import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Mail,
  MessageCircle,
  Phone,
  Receipt,
  ShieldAlert,
  Stethoscope,
  User,
} from 'lucide-react'
import { buildWhatsAppUrl } from '@/lib/utils/whatsapp'
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
import { listAllergies, type PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import {
  listDiagnoses,
  type PatientDiagnosisDTO,
} from '@/lib/core/patient-medical/diagnoses'
import { listHistory, type PatientHistoryDTO } from '@/lib/core/patient-medical/history'
import { listVitalSigns, type VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import type { TreatmentStep } from '@/lib/core/treatment-steps/list'
import type {
  PaymentRecordDTO,
  PatientFinancialSummary,
} from '@/lib/core/payments/list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { calculateAge, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
  AppointmentsHistoryTable,
  type AppointmentHistoryRow,
} from './appointments-history-table'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { id: string }
}

/**
 * Renderizada quando getPatient falha mas o usuario e admin — mostra
 * apenas as causas das falhas. Para nao-admins o throw original sobe.
 */
function FailuresOnlyView({
  failures,
}: {
  failures: Array<{ section: string; message: string }>
}) {
  return (
    <div className="space-y-6">
      <Link
        href="/operacao/pacientes"
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-3 w-3" /> Voltar para pacientes
      </Link>
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="space-y-2 p-4 text-sm">
          <p className="font-bold text-rose-900">
            {failures.length} secao(oes) falharam (visivel so para admin):
          </p>
          <ul className="space-y-2">
            {failures.map((f, idx) => (
              <li key={`${f.section}-${idx}`} className="space-y-1">
                <p className="font-mono text-[11px] font-bold text-rose-800">
                  {f.section}
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-700">
                  {f.message}
                </pre>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
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

  // Cada secao roda em try/catch independente. Se uma migration nao
  // estiver em prod, a secao volta vazia e o erro e logado/exibido para
  // admin — em vez de quebrar a pagina inteira via error boundary.
  const failures: Array<{ section: string; message: string }> = []
  function recordFailure(section: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[paciente-detail] ${section} failed`, {
      patientId: params.id,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
    failures.push({ section, message })
  }
  function safeFail<T>(section: string, fallback: T) {
    return (err: unknown): T => {
      recordFailure(section, err)
      return fallback
    }
  }

  let detail: Awaited<ReturnType<typeof getPatient>> | null = null
  try {
    detail = await getPatient(typedClient, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) notFound()
    recordFailure('patient', err)
    if (session.role !== 'admin') throw err
  }
  if (!detail) {
    return <FailuresOnlyView failures={failures} />
  }
  const { patient, summary } = detail

  const appointmentsPromise: Promise<AppointmentRow[]> = (async () => {
    const res = await supabase
      .from('appointments_effective')
      .select('id, appointment_at, frozen_amount_cents, net_amount_cents, effective_status')
      .eq('patient_id', params.id)
      .order('appointment_at', { ascending: false })
      .limit(50)
    if (res.error) throw new Error(res.error.message)
    return (res.data ?? []) as AppointmentRow[]
  })().catch(safeFail<AppointmentRow[]>('appointments', []))

  const recordsPromise: Promise<ClinicalRecordRow[]> = listClinicalRecords(
    typedClient,
    { tenantId: session.tenantId, patientId: params.id },
  ).catch(safeFail<ClinicalRecordRow[]>('clinical-records', []))

  const treatmentStepsPromise: Promise<TreatmentStep[]> = listTreatmentSteps(
    typedClient,
    {
      tenantId: session.tenantId,
      patientId: params.id,
      patientPlanId: patient.healthPlan?.id ?? null,
    },
  ).catch(safeFail<TreatmentStep[]>('treatment-steps', []))

  const paymentsFallback: Awaited<ReturnType<typeof listPaymentsForPatient>> = {
    records: [] as PaymentRecordDTO[],
    summary: {} as PatientFinancialSummary,
  }
  const paymentsPromise = listPaymentsForPatient(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  }).catch(safeFail<typeof paymentsFallback>('payments', paymentsFallback))

  const allergiesPromise: Promise<PatientAllergyDTO[]> = listAllergies(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  }).catch(safeFail<PatientAllergyDTO[]>('allergies', []))
  const historyPromise: Promise<PatientHistoryDTO[]> = listHistory(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  }).catch(safeFail<PatientHistoryDTO[]>('history', []))
  const vitalSignsPromise: Promise<VitalSignsDTO[]> = listVitalSigns(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  }).catch(safeFail<VitalSignsDTO[]>('vital-signs', []))
  const diagnosesPromise: Promise<PatientDiagnosisDTO[]> = listDiagnoses(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  }).catch(safeFail<PatientDiagnosisDTO[]>('diagnoses', []))

  const [
    appointments,
    records,
    treatmentSteps,
    payments,
    allergies,
    medicalHistory,
    vitalSigns,
    diagnoses,
  ] = await Promise.all([
    appointmentsPromise,
    recordsPromise,
    treatmentStepsPromise,
    paymentsPromise,
    allergiesPromise,
    historyPromise,
    vitalSignsPromise,
    diagnosesPromise,
  ])

  // Mapa appointment_id → step_id para distinguir orfaos (sem step
  // vinculada) dos ja importados no plano. O botao "Adicionar ao plano"
  // so aparece nos orfaos.
  const appointmentIds = appointments
    .map((a) => a.id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const stepByAppointment = new Map<string, string>()
  if (appointmentIds.length > 0) {
    try {
      const stepsRes = await supabase
        .from('treatment_plan_steps')
        .select('id, appointment_id')
        .eq('tenant_id', session.tenantId)
        .in('appointment_id', appointmentIds)
      if (stepsRes.error) throw new Error(stepsRes.error.message)
      for (const row of (stepsRes.data ?? []) as Array<{
        id: string
        appointment_id: string | null
      }>) {
        if (row.appointment_id) stepByAppointment.set(row.appointment_id, row.id)
      }
    } catch (err) {
      recordFailure('appointment-step-link', err)
    }
  }
  const historyRows: AppointmentHistoryRow[] = appointments
    .filter((a): a is AppointmentRow & { id: string } => typeof a.id === 'string' && a.id.length > 0)
    .map((a) => ({
      id: a.id,
      appointmentAt: a.appointment_at,
      frozenAmountCents: a.frozen_amount_cents,
      netAmountCents: a.net_amount_cents,
      effectiveStatus: a.effective_status,
      stepId: stepByAppointment.get(a.id) ?? null,
    }))

  const [proceduresRes, healthPlansRes, doctorsRes] = await Promise.all([
    supabase
      .from('procedures')
      .select(
        'id, tuss_code, display_name, covered_by_plan, default_amount_cents, is_unlisted, custom_code_id, ' +
          'custom_procedure_codes:custom_code_id(code, description)',
      )
      .eq('active', true)
      .is('deleted_at', null)
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
      tuss_code: string | null
      display_name: string | null
      covered_by_plan: boolean
      default_amount_cents: number | null
      is_unlisted: boolean | null
      custom_code_id: string | null
      custom_procedure_codes: { code: string; description: string } | null
    }>
  ).map((p) => {
    const customCode = p.custom_procedure_codes?.code ?? null
    const codeLabel = customCode ?? p.tuss_code ?? '(não listado)'
    return {
      id: p.id,
      tussCode: codeLabel,
      displayName: p.display_name,
      coveredByPlan: p.covered_by_plan,
      defaultAmountCents: p.default_amount_cents,
      isUnlisted: p.is_unlisted === true,
      isCustomCoded: customCode !== null,
    }
  })
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

  const showFailuresCard = session.role === 'admin' && failures.length > 0

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

      {showFailuresCard ? (
        <Card className="border-rose-200 bg-rose-50/40">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-bold text-rose-900">
              {failures.length} seção(ões) falharam (visível só para admin):
            </p>
            <ul className="space-y-2">
              {failures.map((f) => (
                <li key={f.section} className="space-y-1">
                  <p className="font-mono text-[11px] font-bold text-rose-800">
                    {f.section}
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-700">
                    {f.message}
                  </pre>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

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
                      Homio: {patient.ghlContactId}
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
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <ContactChip
                      icon={Phone}
                      label="Telefone"
                      value={patient.phone}
                      color="emerald"
                    />
                  </div>
                  <WhatsAppButton phone={patient.phone} />
                </div>
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
          label="Cancelados"
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
          <AppointmentsHistoryTable
            patientId={params.id}
            rows={historyRows}
            canImportToPlan={canWriteTreatment && !isAnonymized}
          />
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

      {isAnonymized ? null : (
        <DiagnosticsSection
          patientId={params.id}
          initialDiagnoses={diagnoses}
          canWrite={session.role === 'admin' || session.role === 'profissional_saude'}
          canDelete={session.role === 'admin'}
        />
      )}

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

function WhatsAppButton({ phone }: { phone: string | null | undefined }) {
  const url = buildWhatsAppUrl(phone)
  if (!url) {
    return (
      <span
        title="Sem telefone cadastrado"
        aria-disabled="true"
        className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md bg-slate-100 px-3 text-xs font-bold text-slate-400"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-3 text-xs font-bold text-white transition hover:bg-green-700"
      title="Abrir conversa no WhatsApp"
    >
      <MessageCircle className="h-3.5 w-3.5" />
      WhatsApp
    </a>
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

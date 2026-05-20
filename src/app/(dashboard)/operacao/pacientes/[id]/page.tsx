import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { getPatient } from '@/lib/core/patients/get'
import { listClinicalRecords } from '@/lib/core/clinical-records/list'
import { listTreatmentSteps } from '@/lib/core/treatment-steps/list'
import { listPaymentsForPatient } from '@/lib/core/payments/list'
import { listAllergies, type PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import {
  listDiagnoses,
  type PatientDiagnosisDTO,
} from '@/lib/core/patient-medical/diagnoses'
import { listHistory, type PatientHistoryDTO } from '@/lib/core/patient-medical/history'
import { listVitalSigns, type VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import {
  assembleTimelineEvents,
  buildQuickViewSnapshot,
  collectAuthorUserIds,
  resolveAuthors,
  type AppointmentTimelineRow,
} from '@/lib/core/patient-timeline'
import { can } from '@/lib/auth/rbac'
import { Card, CardContent } from '@/components/ui/card'
import type { Database } from '@/lib/db/types'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import type { TreatmentStep } from '@/lib/core/treatment-steps/list'
import type {
  PaymentRecordDTO,
  PatientFinancialSummary,
} from '@/lib/core/payments/list'
import {
  type DoctorOption,
  type HealthPlanOption,
  type ProcedureOption,
} from './treatment-steps-section'
import { PatientCleanupButton } from './cleanup-button'
import { PatientDetailLayout } from './_components/patient-detail-layout'
import type { AnamnesePatientPrefill } from './clinical-records-section'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { id: string }
  searchParams: { tab?: string }
}

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
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="space-y-2 p-4 text-sm">
          <p className="font-bold text-rose-900">
            {failures.length} seção(ões) falharam (visível só para admin):
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

export default async function PacienteDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const typedClient = supabase as unknown as SupabaseClient<Database>

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
      .select(
        'id, appointment_at, frozen_amount_cents, net_amount_cents, effective_status',
      )
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

  const remindersOptInPromise: Promise<boolean> = (async () => {
    try {
      const res = await typedClient
        .from('patients')
        .select('reminders_opt_in')
        .eq('id', params.id)
        .eq('tenant_id', session.tenantId)
        .maybeSingle()
      const row = res.data as { reminders_opt_in: boolean | null } | null
      return row?.reminders_opt_in !== false
    } catch {
      return true
    }
  })()

  const allergiesPromise: Promise<PatientAllergyDTO[]> = listAllergies(
    typedClient,
    { tenantId: session.tenantId, patientId: params.id },
  ).catch(safeFail<PatientAllergyDTO[]>('allergies', []))
  const historyPromise: Promise<PatientHistoryDTO[]> = listHistory(typedClient, {
    tenantId: session.tenantId,
    patientId: params.id,
  }).catch(safeFail<PatientHistoryDTO[]>('history', []))
  const vitalSignsPromise: Promise<VitalSignsDTO[]> = listVitalSigns(
    typedClient,
    { tenantId: session.tenantId, patientId: params.id },
  ).catch(safeFail<VitalSignsDTO[]>('vital-signs', []))
  const diagnosesPromise: Promise<PatientDiagnosisDTO[]> = listDiagnoses(
    typedClient,
    { tenantId: session.tenantId, patientId: params.id },
  ).catch(safeFail<PatientDiagnosisDTO[]>('diagnoses', []))

  const [
    appointments,
    records,
    treatmentSteps,
    payments,
    allergies,
    medicalHistory,
    vitalSigns,
    diagnoses,
    remindersOptIn,
  ] = await Promise.all([
    appointmentsPromise,
    recordsPromise,
    treatmentStepsPromise,
    paymentsPromise,
    allergiesPromise,
    historyPromise,
    vitalSignsPromise,
    diagnosesPromise,
    remindersOptInPromise,
  ])

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
      .select('id, user_id, full_name, role, specialty')
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
  ).map((hp) => ({ id: hp.id, name: hp.name }))

  const doctorRows = (doctorsRes.data ?? []) as Array<{
    id: string
    user_id: string | null
    full_name: string
    role: string | null
    specialty: string | null
  }>
  const doctorsList: DoctorOption[] = doctorRows.map((d) => ({
    id: d.id,
    fullName: d.full_name,
    role: d.role,
    specialty: d.specialty,
  }))

  const appointmentTimelineRows: AppointmentTimelineRow[] = appointments
    .filter(
      (a): a is AppointmentRow & { id: string } =>
        typeof a.id === 'string' && a.id.length > 0,
    )
    .map((a) => ({
      id: a.id,
      appointmentAt: a.appointment_at,
      frozenAmountCents: a.frozen_amount_cents,
      netAmountCents: a.net_amount_cents,
      effectiveStatus: a.effective_status,
      procedureName: null,
      tussCode: null,
      doctorName: null,
      planName: null,
      createdBy: null,
    }))

  const events = assembleTimelineEvents({
    clinicalRecords: records,
    vitalSigns,
    appointments: appointmentTimelineRows,
    payments: payments.records,
    isAnonymized: patient.anonymizedAt !== null,
    limit: 200,
  })

  const authorIds = collectAuthorUserIds(events)
  let authors: ReadonlyMap<string, string> = new Map()
  if (authorIds.size > 0) {
    authors = await resolveAuthors(typedClient, {
      tenantId: session.tenantId,
      userIds: authorIds,
      knownDoctors: doctorRows.map((d) => ({
        user_id: d.user_id,
        full_name: d.full_name,
      })),
    }).catch(safeFail<ReadonlyMap<string, string>>('authors', new Map()))
  }

  const snapshot = buildQuickViewSnapshot({
    patient,
    summary,
    allergies,
    diagnoses,
    vitalSigns,
    payments: payments.records,
    role: session.role,
  })

  const canEditPatient =
    session.role === 'admin' || session.role === 'recepcionista'
  const canWriteClinical =
    session.role === 'admin' ||
    session.role === 'financeiro' ||
    session.role === 'profissional_saude'
  const canWriteTreatment =
    session.role === 'admin' ||
    session.role === 'financeiro' ||
    session.role === 'profissional_saude'
  const canApplyAnamnesis = session.role === 'admin'
  const canDeleteAnamnese = session.role === 'admin'
  const canWriteVitals =
    session.role === 'admin' || session.role === 'profissional_saude'
  const canWriteDiagnosis =
    session.role === 'admin' || session.role === 'profissional_saude'
  const canDeleteDiagnosis = session.role === 'admin'
  const canRecordPayment =
    session.role === 'admin' || session.role === 'financeiro'
  const canConfigReminders = can(session.role, 'reminders.config')

  const isAnonymized = patient.anonymizedAt !== null
  const anamnesePrefill: AnamnesePatientPrefill | undefined = isAnonymized
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

  const initialTab: 'clinico' | 'cadastro' =
    searchParams.tab === 'cadastro' ? 'cadastro' : 'clinico'

  const showFailuresCard = session.role === 'admin' && failures.length > 0

  return (
    <div className="space-y-4">
      {showFailuresCard ? (
        <Card className="border-destructive/30 bg-destructive/5">
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

      {session.role === 'admin' && !isAnonymized ? (
        <div className="flex justify-end">
          <PatientCleanupButton patientId={params.id} />
        </div>
      ) : null}

      <PatientDetailLayout
        patientId={params.id}
        patient={patient}
        snapshot={snapshot}
        events={events}
        authors={authors}
        initialTab={initialTab}
        cadastro={{
          initialAllergies: allergies,
          initialHistory: medicalHistory,
          initialDiagnoses: diagnoses,
          initialVitalSigns: vitalSigns,
          initialRecords: records,
          initialTreatmentSteps: treatmentSteps,
          initialPayments: payments,
          procedures,
          healthPlansList,
          doctorsList,
          remindersOptIn,
          anamnesePrefill,
          canEditPatient,
          canConfigReminders,
          canWriteClinical,
          canWriteTreatment,
          canApplyAnamnesis,
          canDeleteAnamnese,
          canRecordPayment,
          canWriteVitals,
          canWriteDiagnosis,
          canDeleteDiagnosis,
        }}
      />
    </div>
  )
}

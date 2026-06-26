'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PatientQuickView } from './patient-quick-view'
import { ClinicalTimeline } from './clinical-timeline'
import { CadastroTab } from './cadastro-tab'
import { CareNotesEditor } from '../care-notes-editor'
import { WorkoutEditor } from '../workout-editor'
import { DietEditor } from '../diet-editor'
import { PatientEvolutionTab } from './patient-evolution-tab'
import { OdontoSpace } from './odontogram/odonto-space'
import { NewEvolutionSheet } from './sheets/new-evolution-sheet'
import { NewAnamneseSheet } from './sheets/new-anamnese-sheet'
import { NewVitalSheet } from './sheets/new-vital-sheet'
import { NewDiagnosisSheet } from './sheets/new-diagnosis-sheet'
import { MobileQuickViewHeader } from './mobile-quick-view-header'
import { MobileActionBar } from './mobile-action-bar'
import { PatientAlertModal } from './patient-alert-modal'
import { cn } from '@/lib/utils'
import type {
  AppointmentTimelineRow,
  AuthorMap,
  QuickViewSnapshot,
  SheetKind,
  TimelineEvent,
} from '@/lib/core/patient-timeline'
import type { PatientDetail } from '@/lib/core/patients/get'
import type { PatientHistoryDTO } from '@/lib/core/patient-medical/history'
import type { PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import type { TreatmentStep } from '@/lib/core/treatment-steps/list'
import type {
  PatientFinancialSummary,
  PaymentRecordDTO,
} from '@/lib/core/payments/list'
import type {
  DoctorOption,
  HealthPlanOption,
  ProcedureOption,
} from '../treatment-steps-section'
import type { AnamnesePatientPrefill } from '../clinical-records-section'

interface Props {
  patientId: string
  patient: PatientDetail
  snapshot: QuickViewSnapshot
  events: TimelineEvent[]
  appointments: AppointmentTimelineRow[]
  authors: AuthorMap
  initialTab: 'evolucao' | 'clinico' | 'cadastro' | 'odontograma'
  /** Módulo Odontologia ativo. Off ⇒ esconde a aba Odonto-Space. */
  hasOdonto: boolean
  /** Módulos Treino/Dieta ativos. Off ⇒ escondem as seções no prontuário. */
  hasTreino: boolean
  hasDieta: boolean
  cadastro: {
    initialHistory: PatientHistoryDTO[]
    initialDiagnoses: PatientDiagnosisDTO[]
    initialVitalSigns: VitalSignsDTO[]
    initialMeasurements: Record<string, MeasurementDTO[]>
    metricTypes: PatientMetricType[]
    initialRecords: ClinicalRecordRow[]
    initialTreatmentSteps: TreatmentStep[]
    initialPayments: {
      records: PaymentRecordDTO[]
      summary: PatientFinancialSummary
    }
    procedures: ProcedureOption[]
    healthPlansList: HealthPlanOption[]
    doctorsList: DoctorOption[]
    remindersOptIn: boolean
    anamnesePrefill: AnamnesePatientPrefill | undefined
    canEditPatient: boolean
    canConfigReminders: boolean
    canWriteClinical: boolean
    canWriteTreatment: boolean
    canApplyAnamnesis: boolean
    canDeleteAnamnese: boolean
    canRecordPayment: boolean
    canViewFinancialValues: boolean
    hasEndocrino: boolean
    hasConvenio: boolean
    hasOftalmo: boolean
    canWriteVitals: boolean
    canWriteDiagnosis: boolean
    canDeleteDiagnosis: boolean
  }
}

function isValidTab(
  value: string | null,
): value is 'evolucao' | 'clinico' | 'cadastro' | 'odontograma' {
  return (
    value === 'evolucao' ||
    value === 'clinico' ||
    value === 'cadastro' ||
    value === 'odontograma'
  )
}

export function PatientDetailLayout({
  patientId,
  patient,
  snapshot,
  events,
  appointments,
  authors,
  initialTab,
  hasOdonto,
  hasTreino,
  hasDieta,
  cadastro,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams.get('tab')
  // 'odontograma' só é uma aba válida quando o módulo Odontologia está ativo —
  // acesso direto por URL com o módulo off degrada para a aba padrão.
  const tabAllowed = (
    v: string | null,
  ): v is 'evolucao' | 'clinico' | 'cadastro' | 'odontograma' =>
    isValidTab(v) && (v !== 'odontograma' || hasOdonto)
  const [tab, setTab] = useState<'evolucao' | 'clinico' | 'cadastro' | 'odontograma'>(
    tabAllowed(tabFromUrl) ? tabFromUrl : initialTab,
  )
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null)

  useEffect(() => {
    if (
      isValidTab(tabFromUrl) &&
      (tabFromUrl !== 'odontograma' || hasOdonto) &&
      tabFromUrl !== tab
    ) {
      setTab(tabFromUrl)
    }
  }, [tabFromUrl, tab, hasOdonto])

  const updateTab = useCallback(
    (next: 'evolucao' | 'clinico' | 'cadastro' | 'odontograma') => {
      setTab(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'evolucao') {
        params.delete('tab')
      } else {
        params.set('tab', next)
      }
      const qs = params.toString()
      router.replace(
        `/operacao/pacientes/${patientId}${qs ? `?${qs}` : ''}`,
        { scroll: false },
      )
    },
    [patientId, router, searchParams],
  )

  const handleOpenSheet = useCallback(
    (sheet: SheetKind) => {
      // US2: sheets dedicados para os 4 fluxos clínicos mais frequentes.
      // Os outros 4 (texto, arquivo, alergia, antecedente) ainda levam
      // para a aba Cadastro — promover se houver feedback de uso.
      if (
        sheet === 'new-evolution' ||
        sheet === 'new-anamnese' ||
        sheet === 'new-vital' ||
        sheet === 'new-diagnosis'
      ) {
        setActiveSheet(sheet)
      } else {
        updateTab('cadastro')
      }
    },
    [updateTab],
  )

  const handlePrint = useCallback(() => {
    // Backlog 1/7 — abre em nova aba como pré-visualização (o visualizador do
    // navegador permite baixar/imprimir a partir daí).
    window.open(`/api/pacientes/${patientId}/prontuario/pdf?inline=1`, '_blank')
  }, [patientId])

  const isAnonymized = snapshot.identity.isAnonymized

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/operacao/pacientes"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para pacientes
        </Link>
      </div>

      {/* Backlog 1/5 — banner de paciente inativo/óbito (bloqueia agenda/mensagens). */}
      {patient.status !== 'ativo' ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
        >
          {patient.status === 'obito'
            ? 'Paciente marcado como ÓBITO'
            : 'Paciente INATIVO'}{' '}
          — novos agendamentos e mensagens automáticas estão bloqueados.
        </div>
      ) : null}

      {/* Header compacto colapsável — só mobile */}
      <MobileQuickViewHeader
        patientId={patientId}
        snapshot={snapshot}
        onOpenSheet={handleOpenSheet}
        onSwitchToCadastro={() => updateTab('cadastro')}
        onPrint={handlePrint}
        canViewFinancialValues={cadastro.canViewFinancialValues}
      />

      <div
        className={cn(
          'grid grid-cols-1 gap-4',
          'md:grid-cols-[320px_minmax(0,1fr)]',
        )}
      >
        {/* Sidebar full — só desktop (md+) */}
        <aside className="hidden md:sticky md:top-4 md:block md:max-h-[calc(100vh-2rem)] md:overflow-y-auto md:pr-1">
          <PatientQuickView
            patientId={patientId}
            snapshot={snapshot}
            onOpenSheet={handleOpenSheet}
            onSwitchToCadastro={() => updateTab('cadastro')}
            onPrint={handlePrint}
            canViewFinancialValues={cadastro.canViewFinancialValues}
          />
        </aside>

        {/* Coluna direita: tabs */}
        <section className="min-w-0">
          <Tabs
            value={tab}
            onValueChange={(v) =>
              updateTab(v as 'evolucao' | 'clinico' | 'cadastro' | 'odontograma')
            }
          >
            <TabsList>
              {!isAnonymized ? (
                <TabsTrigger value="evolucao">Evolução do paciente</TabsTrigger>
              ) : null}
              <TabsTrigger value="clinico">Clínico</TabsTrigger>
              {!isAnonymized ? (
                <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
              ) : null}
              {!isAnonymized && hasOdonto ? (
                <TabsTrigger value="odontograma">Odonto-Space</TabsTrigger>
              ) : null}
            </TabsList>
            {!isAnonymized ? (
              <TabsContent value="evolucao" className="space-y-4">
                <PatientEvolutionTab
                  patientId={patientId}
                  appointments={appointments}
                  initialNotes={cadastro.initialRecords}
                  authors={authors}
                  canWriteNote={cadastro.canWriteClinical}
                />
              </TabsContent>
            ) : null}
            <TabsContent value="clinico" className="space-y-4">
              <ClinicalTimeline
                events={events}
                authors={authors}
                isAnonymized={isAnonymized}
                canViewValues={cadastro.canViewFinancialValues}
              />
              {!isAnonymized ? (
                <>
                  <CareNotesEditor patientId={patientId} canWrite={cadastro.canWriteClinical} />
                  {hasTreino ? (
                    <WorkoutEditor patientId={patientId} canWrite={cadastro.canWriteClinical} />
                  ) : null}
                  {hasDieta ? (
                    <DietEditor patientId={patientId} canWrite={cadastro.canWriteClinical} />
                  ) : null}
                </>
              ) : null}
            </TabsContent>
            {!isAnonymized ? (
              <TabsContent value="cadastro">
                <CadastroTab
                  patient={patient}
                  patientId={patientId}
                  initialHistory={cadastro.initialHistory}
                  initialDiagnoses={cadastro.initialDiagnoses}
                  initialVitalSigns={cadastro.initialVitalSigns}
                  initialMeasurements={cadastro.initialMeasurements}
                  metricTypes={cadastro.metricTypes}
                  initialRecords={cadastro.initialRecords}
                  initialTreatmentSteps={cadastro.initialTreatmentSteps}
                  initialPayments={cadastro.initialPayments}
                  procedures={cadastro.procedures}
                  healthPlansList={cadastro.healthPlansList}
                  doctorsList={cadastro.doctorsList}
                  remindersOptIn={cadastro.remindersOptIn}
                  anamnesePrefill={cadastro.anamnesePrefill}
                  canEditPatient={cadastro.canEditPatient}
                  canConfigReminders={cadastro.canConfigReminders}
                  canWriteClinical={cadastro.canWriteClinical}
                  canWriteTreatment={cadastro.canWriteTreatment}
                  canApplyAnamnesis={cadastro.canApplyAnamnesis}
                  canDeleteAnamnese={cadastro.canDeleteAnamnese}
                  canRecordPayment={cadastro.canRecordPayment}
                  canViewFinancialValues={cadastro.canViewFinancialValues}
                  hasEndocrino={cadastro.hasEndocrino}
                  hasConvenio={cadastro.hasConvenio}
                  hasOftalmo={cadastro.hasOftalmo}
                  canWriteVitals={cadastro.canWriteVitals}
                  canWriteDiagnosis={cadastro.canWriteDiagnosis}
                  canDeleteDiagnosis={cadastro.canDeleteDiagnosis}
                />
              </TabsContent>
            ) : null}
            {!isAnonymized && hasOdonto ? (
              <TabsContent value="odontograma" className="space-y-4">
                <OdontoSpace
                  patientId={patientId}
                  canWriteClinical={cadastro.canWriteClinical}
                  canWriteTreatment={cadastro.canWriteTreatment}
                />
              </TabsContent>
            ) : null}
          </Tabs>
        </section>
      </div>

      {/* US2 Sheets — montados no orquestrador para preservar o state
          do ?tab atrás. Fechamento via Esc/overlay/X do Radix Dialog. */}
      <NewEvolutionSheet
        open={activeSheet === 'new-evolution'}
        onOpenChange={(open) => setActiveSheet(open ? 'new-evolution' : null)}
        patientId={patientId}
        patientName={patient.fullName || null}
        initialRecords={cadastro.initialRecords}
        canWrite={cadastro.canWriteClinical}
        canDeleteAnamnese={cadastro.canDeleteAnamnese}
      />
      <NewAnamneseSheet
        open={activeSheet === 'new-anamnese'}
        onOpenChange={(open) => setActiveSheet(open ? 'new-anamnese' : null)}
        patientId={patientId}
        patientName={patient.fullName || null}
        patientPrefill={cadastro.anamnesePrefill}
        initialRecords={cadastro.initialRecords}
        canApplyAnamnesis={cadastro.canApplyAnamnesis}
        canDeleteAnamnese={cadastro.canDeleteAnamnese}
      />
      <NewVitalSheet
        open={activeSheet === 'new-vital'}
        onOpenChange={(open) => setActiveSheet(open ? 'new-vital' : null)}
        patientId={patientId}
        initialVitalSigns={cadastro.initialVitalSigns}
        canWrite={cadastro.canWriteVitals}
      />
      <NewDiagnosisSheet
        open={activeSheet === 'new-diagnosis'}
        onOpenChange={(open) => setActiveSheet(open ? 'new-diagnosis' : null)}
        patientId={patientId}
        initialDiagnoses={cadastro.initialDiagnoses}
        canWrite={cadastro.canWriteDiagnosis}
        canDelete={cadastro.canDeleteDiagnosis}
      />

      {/* FAB bar fixa no rodapé — só mobile. Padding-bottom no body global
          via CSS para evitar a barra cobrir conteúdo do final da timeline. */}
      <div className="h-16 md:hidden" aria-hidden="true" />
      <MobileActionBar
        permissions={snapshot.permissions}
        onOpenSheet={handleOpenSheet}
        onPrint={handlePrint}
      />

      {/* Backlog 1/11 — pop-up bloqueante de aviso por paciente (ao abrir). */}
      <PatientAlertModal alertNote={patient.alertNote} />
    </div>
  )
}

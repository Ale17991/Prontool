'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PatientQuickView } from './patient-quick-view'
import { ClinicalTimeline } from './clinical-timeline'
import { CadastroTab } from './cadastro-tab'
import { cn } from '@/lib/utils'
import type {
  AuthorMap,
  QuickViewSnapshot,
  SheetKind,
  TimelineEvent,
} from '@/lib/core/patient-timeline'
import type { PatientDetail } from '@/lib/core/patients/get'
import type { PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import type { PatientHistoryDTO } from '@/lib/core/patient-medical/history'
import type { PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
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
  authors: AuthorMap
  initialTab: 'clinico' | 'cadastro'
  cadastro: {
    initialAllergies: PatientAllergyDTO[]
    initialHistory: PatientHistoryDTO[]
    initialDiagnoses: PatientDiagnosisDTO[]
    initialVitalSigns: VitalSignsDTO[]
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
    canWriteVitals: boolean
    canWriteDiagnosis: boolean
    canDeleteDiagnosis: boolean
  }
}

function isValidTab(value: string | null): value is 'clinico' | 'cadastro' {
  return value === 'clinico' || value === 'cadastro'
}

export function PatientDetailLayout({
  patientId,
  patient,
  snapshot,
  events,
  authors,
  initialTab,
  cadastro,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams.get('tab')
  const [tab, setTab] = useState<'clinico' | 'cadastro'>(
    isValidTab(tabFromUrl) ? tabFromUrl : initialTab,
  )

  useEffect(() => {
    if (isValidTab(tabFromUrl) && tabFromUrl !== tab) {
      setTab(tabFromUrl)
    }
  }, [tabFromUrl, tab])

  const updateTab = useCallback(
    (next: 'clinico' | 'cadastro') => {
      setTab(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'clinico') {
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
    (_sheet: SheetKind) => {
      // MVP US1: ações da sidebar levam para a aba "Cadastro" onde os
      // formulários existentes seguem funcionais. Sheets dedicados ficam
      // como follow-up (US2).
      updateTab('cadastro')
    },
    [updateTab],
  )

  const handlePrint = useCallback(() => {
    window.open(`/api/pacientes/${patientId}/prontuario/pdf`, '_blank')
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

      <div
        className={cn(
          'grid grid-cols-1 gap-4',
          'md:grid-cols-[320px_minmax(0,1fr)]',
        )}
      >
        {/* Sidebar (desktop sticky / mobile inline top) */}
        <aside className="md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto md:pr-1">
          <PatientQuickView
            snapshot={snapshot}
            onOpenSheet={handleOpenSheet}
            onSwitchToCadastro={() => updateTab('cadastro')}
            onPrint={handlePrint}
          />
        </aside>

        {/* Coluna direita: tabs */}
        <section className="min-w-0">
          <Tabs
            value={tab}
            onValueChange={(v) => updateTab(v as 'clinico' | 'cadastro')}
          >
            <TabsList>
              <TabsTrigger value="clinico">Clínico</TabsTrigger>
              {!isAnonymized ? (
                <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="clinico" className="space-y-4">
              <ClinicalTimeline
                events={events}
                authors={authors}
                isAnonymized={isAnonymized}
              />
            </TabsContent>
            {!isAnonymized ? (
              <TabsContent value="cadastro">
                <CadastroTab
                  patient={patient}
                  patientId={patientId}
                  initialAllergies={cadastro.initialAllergies}
                  initialHistory={cadastro.initialHistory}
                  initialDiagnoses={cadastro.initialDiagnoses}
                  initialVitalSigns={cadastro.initialVitalSigns}
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
                  canWriteVitals={cadastro.canWriteVitals}
                  canWriteDiagnosis={cadastro.canWriteDiagnosis}
                  canDeleteDiagnosis={cadastro.canDeleteDiagnosis}
                />
              </TabsContent>
            ) : null}
          </Tabs>
        </section>
      </div>
    </div>
  )
}

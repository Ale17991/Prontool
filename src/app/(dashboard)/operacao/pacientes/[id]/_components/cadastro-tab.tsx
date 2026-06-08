'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Stethoscope } from 'lucide-react'
import { AddressEditor } from '../address-editor'
import { IdentityEditor } from '../identity-editor'
import { RemindersOptInToggle } from '../reminders-opt-in-toggle'
import { PatientPlanEditor } from '../patient-plan-editor'
import { MedicalHistorySection } from '../medical-history-section'
import { VitalSignsSection } from '../vital-signs-section'
import { MetabolicMetricsSection } from '../metabolic-metrics-section'
import { DiagnosticsSection } from '../diagnosticos-section'
import { ClinicalRecordsSection } from '../clinical-records-section'
import {
  TreatmentStepsSection,
  type DoctorOption,
  type HealthPlanOption,
  type ProcedureOption,
} from '../treatment-steps-section'
import { FinanceiroSection } from '../financeiro-section'
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
import type { AnamnesePatientPrefill } from '../clinical-records-section'

interface Props {
  patient: PatientDetail
  patientId: string
  initialHistory: PatientHistoryDTO[]
  initialDiagnoses: PatientDiagnosisDTO[]
  initialVitalSigns: VitalSignsDTO[]
  initialMeasurements: Record<string, MeasurementDTO[]>
  metricTypes: PatientMetricType[]
  initialRecords: ClinicalRecordRow[]
  initialTreatmentSteps: TreatmentStep[]
  initialPayments: { records: PaymentRecordDTO[]; summary: PatientFinancialSummary }
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

export function CadastroTab({
  patient,
  patientId,
  initialHistory,
  initialDiagnoses,
  initialVitalSigns,
  initialMeasurements,
  metricTypes,
  initialRecords,
  initialTreatmentSteps,
  initialPayments,
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
}: Props) {
  return (
    <div className="space-y-6">
      <IdentityEditor
        patientId={patientId}
        identity={{
          sex: patient.sex,
          phone: patient.phone,
          email: patient.email,
          socialName: patient.socialName,
          motherName: patient.motherName,
          rg: patient.rg,
          insuranceCardNumber: patient.insuranceCardNumber,
          emergencyContactName: patient.emergencyContactName,
          emergencyContactPhone: patient.emergencyContactPhone,
          guardianName: patient.guardianName,
          guardianCpf: patient.guardianCpf,
          guardianRelationship: patient.guardianRelationship,
        }}
        canEdit={canEditPatient}
      />

      <AddressEditor
        patientId={patientId}
        address={patient.address}
        canEdit={canEditPatient}
      />

      <RemindersOptInToggle
        patientId={patientId}
        initialOptIn={remindersOptIn}
        canEdit={canConfigReminders}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Stethoscope className="h-4 w-4 text-primary" />
            Plano de saúde
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PatientPlanEditor
            patientId={patient.id}
            currentPlanId={patient.healthPlan?.id ?? null}
            currentPlanName={patient.healthPlan?.name ?? null}
            healthPlans={healthPlansList}
            canEdit={canEditPatient}
          />
        </CardContent>
      </Card>

      <MedicalHistorySection
        patientId={patientId}
        initialHistory={initialHistory}
        canWrite={canWriteClinical}
        initialVitalSigns={initialVitalSigns}
      />

      <VitalSignsSection
        patientId={patientId}
        initial={initialVitalSigns}
        canWrite={canWriteVitals}
      />

      <MetabolicMetricsSection
        patientId={patientId}
        initialMeasurements={initialMeasurements}
        metricTypes={metricTypes}
        canWrite={canWriteVitals}
      />

      <DiagnosticsSection
        patientId={patientId}
        initialDiagnoses={initialDiagnoses}
        canWrite={canWriteDiagnosis}
        canDelete={canDeleteDiagnosis}
      />

      <ClinicalRecordsSection
        patientId={patientId}
        patientName={patient.fullName || null}
        patientPrefill={anamnesePrefill}
        initialRecords={initialRecords}
        canWrite={canWriteClinical}
        canApplyAnamnesis={canApplyAnamnesis}
        canDeleteAnamnese={canDeleteAnamnese}
      />

      <TreatmentStepsSection
        patientId={patientId}
        patientPlanId={patient.healthPlan?.id ?? null}
        patientPlanName={patient.healthPlan?.name ?? null}
        initialSteps={initialTreatmentSteps}
        procedures={procedures}
        healthPlans={healthPlansList}
        doctors={doctorsList}
        canWrite={canWriteTreatment}
      />

      <FinanceiroSection
        patientId={patientId}
        initialRecords={initialPayments.records}
        initialSummary={initialPayments.summary}
        canRecordPayment={canRecordPayment}
      />
    </div>
  )
}

import type { QuickViewPermissions, QuickViewSnapshot } from './types'
import type { PatientDetail, PatientFinancialSummary } from '@/lib/core/patients/get'
import type { PatientAllergyDTO, AllergySeverity } from '@/lib/core/patient-medical/allergies'
import type { PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { PaymentRecordDTO } from '@/lib/core/payments/list'
import type { TenantRole } from '@/lib/db/types'
import { can } from '@/lib/auth/rbac'
import { buildWhatsAppUrl } from '@/lib/utils/whatsapp'
import { calculateAge } from '@/lib/utils'

const SEVERITY_ORDER: Record<AllergySeverity, number> = {
  grave: 3,
  moderada: 2,
  leve: 1,
}

export interface BuildSnapshotInput {
  patient: PatientDetail
  summary: PatientFinancialSummary
  allergies: PatientAllergyDTO[]
  diagnoses: PatientDiagnosisDTO[]
  vitalSigns: VitalSignsDTO[]
  payments: PaymentRecordDTO[]
  role: TenantRole | null
}

export function buildQuickViewSnapshot(input: BuildSnapshotInput): QuickViewSnapshot {
  const { patient, allergies, diagnoses, vitalSigns, payments, role } = input
  const isAnonymized = patient.anonymizedAt !== null

  const permissions: QuickViewPermissions = {
    canCreateEvolution: can(role, 'anamnesis.write'),
    canCreateAnamnesis: role === 'admin',
    canCreateVital: role === 'admin' || role === 'profissional_saude',
    canCreateAllergy: can(role, 'anamnesis.write'),
    canCreateHistory: can(role, 'anamnesis.write'),
    canCreateDiagnosis: role === 'admin' || role === 'profissional_saude',
    canCreateText: can(role, 'anamnesis.write'),
    canUploadFile: can(role, 'anamnesis.write'),
    canEditPatient: role === 'admin' || role === 'recepcionista',
    canPrint: role === 'admin' || role === 'financeiro' || role === 'profissional_saude',
    canDeleteAnamnese: role === 'admin',
    canImportToPlan: role === 'admin' || role === 'financeiro' || role === 'profissional_saude',
  }

  if (isAnonymized) {
    return {
      identity: {
        fullName: null,
        cpf: null,
        birthDate: null,
        ageYears: null,
        isAnonymized: true,
        ghlContactId: patient.ghlContactId,
      },
      contact: { phone: null, whatsappUrl: null, email: null },
      plan: { id: null, name: null },
      allergies: [],
      diagnoses: [],
      lastVital: null,
      financial: { receivedCents: 0, pendingCents: 0, lastPaidAt: null },
      permissions,
    }
  }

  const sortedAllergies = [...allergies].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  )

  const filteredDiagnoses = diagnoses
    .filter((d) => d.status === 'ativo' || d.status === 'em_acompanhamento')
    .sort((a, b) => {
      if (a.status === b.status) return 0
      return a.status === 'ativo' ? -1 : 1
    })

  const lastVital = vitalSigns.length > 0 ? vitalSigns[0]! : null

  // Valores só para quem tem finance.view_values — senão nem serializa os
  // montantes no payload enviado ao cliente (recepção não vê valores).
  let receivedCents = 0
  let pendingCents = 0
  let lastPaidAt: string | null = null
  if (can(role, 'finance.view_values')) {
    for (const p of payments) {
      receivedCents += p.paidAmountCents
      pendingCents += p.pendingAmountCents
      if (p.paidAt && (!lastPaidAt || p.paidAt > lastPaidAt)) {
        lastPaidAt = p.paidAt
      }
    }
  }

  return {
    identity: {
      fullName: patient.fullName || null,
      cpf: patient.cpf || null,
      birthDate: patient.birthDate,
      ageYears: calculateAge(patient.birthDate),
      isAnonymized: false,
      ghlContactId: patient.ghlContactId,
    },
    contact: {
      phone: patient.phone,
      whatsappUrl: buildWhatsAppUrl(patient.phone),
      email: patient.email,
    },
    plan: {
      id: patient.healthPlan?.id ?? null,
      name: patient.healthPlan?.name ?? null,
    },
    allergies: sortedAllergies,
    diagnoses: filteredDiagnoses,
    lastVital,
    financial: { receivedCents, pendingCents, lastPaidAt },
    permissions,
  }
}

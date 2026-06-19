/**
 * Unit tests para src/lib/core/patient-timeline/quick-view-snapshot.ts
 * Cobre: anonimizado short-circuit, filtragem de diagnósticos por status,
 * sorting por severity, financial.lastPaidAt, permissões por role.
 */
import { describe, it, expect } from 'vitest'
import { buildQuickViewSnapshot } from '@/lib/core/patient-timeline/quick-view-snapshot'
import type { PatientDetail, PatientFinancialSummary } from '@/lib/core/patients/get'
import type { PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import type { PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { PaymentRecordDTO } from '@/lib/core/payments/list'

const PATIENT_BASE: PatientDetail = {
  id: 'p-1',
  ghlContactId: 'ghl-1',
  fullName: 'Maria Teste',
  socialName: null,
  sex: null,
  cpf: '111.222.333-44',
  rg: null,
  motherName: null,
  phone: '+5511999999999',
  email: 'maria@example.com',
  birthDate: '1985-06-15',
  insuranceCardNumber: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  guardianName: null,
  guardianCpf: null,
  guardianRelationship: null,
  address: {
    cep: null, street: null, number: null, complement: null,
    neighborhood: null, city: null, state: null,
  },
  anonymizedAt: null,
  status: 'ativo',
  alertNote: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  healthPlan: { id: 'plan-1', name: 'Unimed' },
}

const SUMMARY_BASE: PatientFinancialSummary = {
  appointmentCount: 0,
  activeAppointmentCount: 0,
  reversedAppointmentCount: 0,
  totalRevenueCents: 0,
  netRevenueCents: 0,
  lastAppointmentAt: null,
}

function allergy(severity: 'leve' | 'moderada' | 'grave', substance = 'X'): PatientAllergyDTO {
  return {
    id: `${severity}-${substance}`,
    patientId: 'p-1',
    substance,
    severity,
    notes: null,
    reportedAt: '2026-01-01T00:00:00Z',
    reportedBy: 'user-a',
    deletedAt: null,
  }
}

function diagnosis(
  id: string,
  status: 'ativo' | 'em_acompanhamento' | 'resolvido',
): PatientDiagnosisDTO {
  return {
    id,
    patientId: 'p-1',
    cid10Code: id,
    cid10Description: `desc-${id}`,
    additionalNotes: null,
    diagnosedAt: '2026-01-01T00:00:00Z',
    status,
    diagnosedBy: 'user-a',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  }
}

function payment(id: string, paid: boolean, paidAt: string | null): PaymentRecordDTO {
  return {
    id,
    tenantId: 'tenant-1',
    patientId: 'p-1',
    appointmentId: null,
    treatmentStepId: null,
    totalAmountCents: 10000,
    paidAmountCents: paid ? 10000 : 0,
    pendingAmountCents: paid ? 0 : 10000,
    overdueAmountCents: 0,
    installmentsCount: 1,
    paymentMethod: 'pix',
    paymentStatus: paid ? 'paid' : 'pending',
    paidAt,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    installments: [],
    procedureLabel: null,
  }
}

describe('buildQuickViewSnapshot', () => {
  it('paciente anonimizado: zera todos os blocos exceto identity+permissions', () => {
    const snapshot = buildQuickViewSnapshot({
      patient: { ...PATIENT_BASE, anonymizedAt: '2026-05-01T00:00:00Z' },
      summary: SUMMARY_BASE,
      allergies: [allergy('grave')],
      diagnoses: [diagnosis('I10', 'ativo')],
      vitalSigns: [],
      payments: [payment('p1', true, '2026-04-01T00:00:00Z')],
      role: 'admin',
    })
    expect(snapshot.identity.isAnonymized).toBe(true)
    expect(snapshot.identity.fullName).toBeNull()
    expect(snapshot.allergies).toEqual([])
    expect(snapshot.diagnoses).toEqual([])
    expect(snapshot.financial).toEqual({ receivedCents: 0, pendingCents: 0, lastPaidAt: null })
  })

  it('filtra diagnósticos: ativo e em_acompanhamento, exclui resolvido', () => {
    const snapshot = buildQuickViewSnapshot({
      patient: PATIENT_BASE,
      summary: SUMMARY_BASE,
      allergies: [],
      diagnoses: [
        diagnosis('I10', 'ativo'),
        diagnosis('E11', 'em_acompanhamento'),
        diagnosis('J03', 'resolvido'),
      ],
      vitalSigns: [],
      payments: [],
      role: 'admin',
    })
    expect(snapshot.diagnoses.map((d) => d.cid10Code).sort()).toEqual(['E11', 'I10'])
  })

  it('ordena diagnósticos: ativo antes de em_acompanhamento', () => {
    const snapshot = buildQuickViewSnapshot({
      patient: PATIENT_BASE,
      summary: SUMMARY_BASE,
      allergies: [],
      diagnoses: [
        diagnosis('E11', 'em_acompanhamento'),
        diagnosis('I10', 'ativo'),
      ],
      vitalSigns: [],
      payments: [],
      role: 'admin',
    })
    expect(snapshot.diagnoses[0]!.status).toBe('ativo')
    expect(snapshot.diagnoses[1]!.status).toBe('em_acompanhamento')
  })

  it('ordena alergias por severidade desc (grave primeiro)', () => {
    const snapshot = buildQuickViewSnapshot({
      patient: PATIENT_BASE,
      summary: SUMMARY_BASE,
      allergies: [allergy('leve', 'A'), allergy('grave', 'B'), allergy('moderada', 'C')],
      diagnoses: [],
      vitalSigns: [],
      payments: [],
      role: 'admin',
    })
    expect(snapshot.allergies.map((a) => a.severity)).toEqual(['grave', 'moderada', 'leve'])
  })

  it('financial.lastPaidAt pega o paidAt mais recente', () => {
    const snapshot = buildQuickViewSnapshot({
      patient: PATIENT_BASE,
      summary: SUMMARY_BASE,
      allergies: [],
      diagnoses: [],
      vitalSigns: [],
      payments: [
        payment('p1', true, '2026-03-01T00:00:00Z'),
        payment('p2', true, '2026-05-15T00:00:00Z'),
        payment('p3', true, '2026-04-10T00:00:00Z'),
        payment('p4', false, null),
      ],
      role: 'admin',
    })
    expect(snapshot.financial.lastPaidAt).toBe('2026-05-15T00:00:00Z')
    expect(snapshot.financial.receivedCents).toBe(30000)
    expect(snapshot.financial.pendingCents).toBe(10000)
  })

  it('permissões por role: admin tem tudo, recepcionista não escreve clínico', () => {
    const adminSnap = buildQuickViewSnapshot({
      patient: PATIENT_BASE, summary: SUMMARY_BASE,
      allergies: [], diagnoses: [], vitalSigns: [], payments: [], role: 'admin',
    })
    expect(adminSnap.permissions.canCreateEvolution).toBe(true)
    expect(adminSnap.permissions.canCreateAnamnesis).toBe(true)
    expect(adminSnap.permissions.canDeleteAnamnese).toBe(true)

    const recepSnap = buildQuickViewSnapshot({
      patient: PATIENT_BASE, summary: SUMMARY_BASE,
      allergies: [], diagnoses: [], vitalSigns: [], payments: [], role: 'recepcionista',
    })
    expect(recepSnap.permissions.canCreateEvolution).toBe(false)
    expect(recepSnap.permissions.canCreateAnamnesis).toBe(false)
    expect(recepSnap.permissions.canDeleteAnamnese).toBe(false)
    expect(recepSnap.permissions.canEditPatient).toBe(true)
  })

  it('lastVital pega o primeiro elemento do array (já ordenado por measured_at desc)', () => {
    const v1: VitalSignsDTO = {
      id: 'v1', patientId: 'p-1', appointmentId: null,
      measuredAt: '2026-05-15T00:00:00Z',
      systolicBp: 130, diastolicBp: 85, heartRate: null, respiratoryRate: null,
      temperatureCelsius: null, oxygenSaturation: null, weightGrams: null,
      heightCm: null, bmi: null, notes: null,
      measuredBy: 'user-a', createdAt: '2026-05-15T00:00:00Z',
    }
    const snapshot = buildQuickViewSnapshot({
      patient: PATIENT_BASE, summary: SUMMARY_BASE,
      allergies: [], diagnoses: [], vitalSigns: [v1], payments: [], role: 'admin',
    })
    expect(snapshot.lastVital?.id).toBe('v1')
    expect(snapshot.lastVital?.systolicBp).toBe(130)
  })
})

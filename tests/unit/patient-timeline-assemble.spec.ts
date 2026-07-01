/**
 * Unit tests para src/lib/core/patient-timeline/assemble.ts
 * Cobre: ordenação por occurredAt desc, tiebreak por kind, restrição
 * de paciente anonimizado, deleted_at em clinical_records, limit.
 */
import { describe, it, expect } from 'vitest'
import { assembleTimelineEvents, collectAuthorUserIds } from '@/lib/core/patient-timeline/assemble'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { PaymentRecordDTO } from '@/lib/core/payments/list'

function makeClinical(
  id: string,
  type: 'anamnese' | 'evolucao' | 'texto' | 'arquivo',
  createdAt: string,
  createdBy = 'user-a',
  deletedAt: string | null = null,
): ClinicalRecordRow {
  return {
    id,
    tenantId: 'tenant-1',
    patientId: 'p-1',
    title: `record-${id}`,
    type,
    content: type === 'texto' ? 'nota' : null,
    fileName: type === 'arquivo' ? 'x.pdf' : null,
    fileUrl: null,
    fileSizeBytes: null,
    anamnesisData:
      type === 'anamnese'
        ? {
            template_id: 't1',
            template_version: 1,
            template_title: 'Padrão',
            fields: [],
            responses: {},
          }
        : null,
    soapData:
      type === 'evolucao'
        ? {
            subjective: 'queixa',
            objective: null,
            assessment: 'avaliação',
            plan: null,
            assessment_cids: [],
          }
        : null,
    createdBy,
    createdAt,
    deletedAt,
  }
}

function makeVital(id: string, measuredAt: string, measuredBy = 'user-b'): VitalSignsDTO {
  return {
    id,
    patientId: 'p-1',
    appointmentId: null,
    measuredAt,
    systolicBp: 120,
    diastolicBp: 80,
    heartRate: 70,
    respiratoryRate: null,
    temperatureCelsius: null,
    oxygenSaturation: null,
    weightGrams: 70000,
    heightCm: 170,
    bmi: 24.2,
    notes: null,
    measuredBy,
    createdAt: measuredAt,
  }
}

function makePayment(id: string, paidAt: string | null, createdAt: string): PaymentRecordDTO {
  return {
    id,
    tenantId: 'tenant-1',
    patientId: 'p-1',
    appointmentId: null,
    treatmentStepId: null,
    totalAmountCents: 10000,
    paidAmountCents: paidAt ? 10000 : 0,
    pendingAmountCents: paidAt ? 0 : 10000,
    overdueAmountCents: 0,
    installmentsCount: 1,
    paymentMethod: 'pix',
    paymentStatus: paidAt ? 'paid' : 'pending',
    paidAt,
    notes: null,
    createdAt,
    installments: [],
    procedureLabel: null,
  }
}

describe('assembleTimelineEvents', () => {
  it('ordena eventos por occurredAt descendente', () => {
    const events = assembleTimelineEvents({
      clinicalRecords: [
        makeClinical('c1', 'evolucao', '2026-03-01T10:00:00Z'),
        makeClinical('c2', 'evolucao', '2026-05-01T10:00:00Z'),
        makeClinical('c3', 'evolucao', '2026-04-01T10:00:00Z'),
      ],
      vitalSigns: [],
      appointments: [],
      payments: [],
      isAnonymized: false,
    })
    expect(events.map((e) => e.id)).toEqual(['clinical:c2', 'clinical:c3', 'clinical:c1'])
  })

  it('aplica tiebreak por kind quando occurredAt é igual', () => {
    const sameTime = '2026-05-01T10:00:00Z'
    const events = assembleTimelineEvents({
      clinicalRecords: [
        makeClinical('c1', 'texto', sameTime),
        makeClinical('c2', 'evolucao', sameTime),
        makeClinical('c3', 'anamnese', sameTime),
      ],
      vitalSigns: [makeVital('v1', sameTime)],
      appointments: [],
      payments: [],
      isAnonymized: false,
    })
    // ordem: evolucao(7), anamnese(6), vital(5), texto(2)
    expect(events.map((e) => e.kind)).toEqual(['evolucao', 'anamnese', 'vital', 'texto'])
  })

  it('paciente anonimizado: retorna apenas appointment + payment', () => {
    const events = assembleTimelineEvents({
      clinicalRecords: [makeClinical('c1', 'evolucao', '2026-05-01T10:00:00Z')],
      vitalSigns: [makeVital('v1', '2026-05-01T10:00:00Z')],
      appointments: [
        {
          id: 'a1',
          appointmentAt: '2026-04-01T10:00:00Z',
          frozenAmountCents: 10000,
          netAmountCents: 9000,
          effectiveStatus: 'concluido',
        },
      ],
      payments: [makePayment('pay1', '2026-04-01T11:00:00Z', '2026-04-01T10:00:00Z')],
      isAnonymized: true,
    })
    expect(events.length).toBe(2)
    expect(events.every((e) => e.kind === 'appointment' || e.kind === 'payment')).toBe(true)
  })

  it('ignora clinical_records com deleted_at != null', () => {
    const events = assembleTimelineEvents({
      clinicalRecords: [
        makeClinical('c1', 'evolucao', '2026-05-01T10:00:00Z'),
        makeClinical('c2', 'evolucao', '2026-04-01T10:00:00Z', 'user-a', '2026-05-15T00:00:00Z'),
      ],
      vitalSigns: [],
      appointments: [],
      payments: [],
      isAnonymized: false,
    })
    expect(events.map((e) => e.id)).toEqual(['clinical:c1'])
  })

  it('respeita limit cortando os eventos mais antigos', () => {
    const records: ClinicalRecordRow[] = []
    for (let i = 0; i < 10; i++) {
      records.push(
        makeClinical(`c${i}`, 'texto', `2026-05-${(i + 1).toString().padStart(2, '0')}T10:00:00Z`),
      )
    }
    const events = assembleTimelineEvents({
      clinicalRecords: records,
      vitalSigns: [],
      appointments: [],
      payments: [],
      isAnonymized: false,
      limit: 3,
    })
    expect(events.length).toBe(3)
    // 3 mais recentes (10, 9, 8)
    expect(events[0]!.id).toBe('clinical:c9')
  })

  it('payment usa paidAt se presente, senão createdAt', () => {
    const events = assembleTimelineEvents({
      clinicalRecords: [],
      vitalSigns: [],
      appointments: [],
      payments: [
        makePayment('pay1', '2026-05-10T10:00:00Z', '2026-05-01T10:00:00Z'),
        makePayment('pay2', null, '2026-05-15T10:00:00Z'),
      ],
      isAnonymized: false,
    })
    // pay2 usa createdAt 05-15; pay1 usa paidAt 05-10 → pay2 vem antes
    expect(events.map((e) => e.id)).toEqual(['payment:pay2', 'payment:pay1'])
  })

  it('descarta appointments sem appointmentAt', () => {
    const events = assembleTimelineEvents({
      clinicalRecords: [],
      vitalSigns: [],
      appointments: [
        {
          id: 'a1',
          appointmentAt: null,
          frozenAmountCents: null,
          netAmountCents: null,
          effectiveStatus: null,
        },
      ],
      payments: [],
      isAnonymized: false,
    })
    expect(events.length).toBe(0)
  })
})

describe('collectAuthorUserIds', () => {
  it('coleta IDs únicos e ignora vazios', () => {
    const events = assembleTimelineEvents({
      clinicalRecords: [
        makeClinical('c1', 'evolucao', '2026-05-01T10:00:00Z', 'user-a'),
        makeClinical('c2', 'evolucao', '2026-05-02T10:00:00Z', 'user-b'),
        makeClinical('c3', 'evolucao', '2026-05-03T10:00:00Z', 'user-a'),
      ],
      vitalSigns: [makeVital('v1', '2026-05-04T10:00:00Z', 'user-c')],
      appointments: [
        {
          id: 'a1',
          appointmentAt: '2026-05-05T10:00:00Z',
          frozenAmountCents: null,
          netAmountCents: null,
          effectiveStatus: null,
        },
      ],
      payments: [],
      isAnonymized: false,
    })
    const ids = collectAuthorUserIds(events)
    expect(ids.has('user-a')).toBe(true)
    expect(ids.has('user-b')).toBe(true)
    expect(ids.has('user-c')).toBe(true)
    // appointment sem createdBy → authorUserId === '' → não entra
    expect(ids.has('')).toBe(false)
    expect(ids.size).toBe(3)
  })
})

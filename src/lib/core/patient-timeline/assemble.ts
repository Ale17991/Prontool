import type {
  AnamneseEvent,
  AppointmentEvent,
  AppointmentTimelineRow,
  ArquivoEvent,
  EvolucaoEvent,
  PaymentEvent,
  TextoEvent,
  TimelineEvent,
  TimelineEventKind,
  VitalEvent,
} from './types'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { PaymentRecordDTO } from '@/lib/core/payments/list'

const KIND_PRIORITY: Record<TimelineEventKind, number> = {
  evolucao: 7,
  anamnese: 6,
  vital: 5,
  appointment: 4,
  arquivo: 3,
  texto: 2,
  payment: 1,
}

export interface AssembleInput {
  clinicalRecords: ClinicalRecordRow[]
  vitalSigns: VitalSignsDTO[]
  appointments: AppointmentTimelineRow[]
  payments: PaymentRecordDTO[]
  isAnonymized: boolean
  limit?: number
}

/**
 * Mescla os 4 streams (clinical_records, vital_signs, appointments, payments)
 * em uma lista única ordenada por occurredAt desc. Quando paciente está
 * anonimizado, retorna apenas appointment + payment (consistente com a
 * renderização restrita atual).
 */
export function assembleTimelineEvents(input: AssembleInput): TimelineEvent[] {
  const events: TimelineEvent[] = []

  if (!input.isAnonymized) {
    for (const r of input.clinicalRecords) {
      if (r.deletedAt) continue
      const base = {
        id: `clinical:${r.id}`,
        occurredAt: r.createdAt,
        authorUserId: r.createdBy,
      }
      if (r.type === 'anamnese') {
        events.push({ ...base, kind: 'anamnese', source: r } satisfies AnamneseEvent)
      } else if (r.type === 'evolucao') {
        events.push({ ...base, kind: 'evolucao', source: r } satisfies EvolucaoEvent)
      } else if (r.type === 'texto') {
        events.push({ ...base, kind: 'texto', source: r } satisfies TextoEvent)
      } else if (r.type === 'arquivo') {
        events.push({ ...base, kind: 'arquivo', source: r } satisfies ArquivoEvent)
      }
    }

    for (const v of input.vitalSigns) {
      events.push({
        id: `vital:${v.id}`,
        kind: 'vital',
        occurredAt: v.measuredAt,
        authorUserId: v.measuredBy,
        source: v,
      } satisfies VitalEvent)
    }
  }

  for (const a of input.appointments) {
    if (!a.appointmentAt) continue
    events.push({
      id: `appointment:${a.id}`,
      kind: 'appointment',
      occurredAt: a.appointmentAt,
      authorUserId: a.createdBy ?? '',
      source: a,
    } satisfies AppointmentEvent)
  }

  for (const p of input.payments) {
    const occurredAt = p.paidAt ?? p.createdAt
    events.push({
      id: `payment:${p.id}`,
      kind: 'payment',
      occurredAt,
      authorUserId: '',
      source: p,
    } satisfies PaymentEvent)
  }

  events.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) {
      return b.occurredAt.localeCompare(a.occurredAt)
    }
    return KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]
  })

  if (input.limit && input.limit > 0 && events.length > input.limit) {
    return events.slice(0, input.limit)
  }
  return events
}

/**
 * Extrai o conjunto único de user_ids autores dos eventos, para alimentar
 * resolveAuthors em batch.
 */
export function collectAuthorUserIds(events: TimelineEvent[]): Set<string> {
  const set = new Set<string>()
  for (const e of events) {
    if (e.authorUserId && e.authorUserId.length > 0) set.add(e.authorUserId)
  }
  return set
}

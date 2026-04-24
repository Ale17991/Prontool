import { z } from 'zod'
import { WebhookPayloadError } from '@/lib/observability/errors'
import type { Database } from '@/lib/db/types'

type TenantGhlConfig = Database['public']['Tables']['tenant_ghl_config']['Row']

/**
 * T077 — parse a GHL webhook payload against the field mapping declared in
 * `tenant_ghl_config`. Returns a typed `ExtractedEvent`, or throws
 * `WebhookPayloadError` listing every missing required field so the worker
 * can route the event to DLQ with actionable `detail`.
 */

export interface ExtractedEvent {
  ghlEventId: string
  ghlContactId: string
  occurredAt: string | undefined
  appointmentAt: string | undefined
  triggerStageName: string | undefined
  plano: string
  tussCode: string
  medicoIdentifier: string
  patient: {
    fullName: string
    cpf: string
    phone: string | undefined
    email: string | undefined
    birthDate: string | undefined
  }
}

const envelope = z.object({
  event_id: z.string().min(1),
  event_type: z.string().optional(),
  occurred_at: z.string().optional(),
  contact: z
    .object({
      id: z.string().min(1),
      custom_fields: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
  pipeline: z
    .object({ id: z.string().optional(), stage_name: z.string().optional() })
    .optional(),
})

export function extractCustomFields(payload: unknown, config: TenantGhlConfig): ExtractedEvent {
  const parsed = envelope.safeParse(payload)
  if (!parsed.success) {
    throw new WebhookPayloadError('GHL payload envelope failed schema validation', {
      issues: parsed.error.issues,
    })
  }
  const body = parsed.data
  const customFieldsRaw = body.contact.custom_fields ?? {}

  // Custom fields can arrive either as a flat object or as an array of
  // { key, value } / { name, value } pairs depending on the GHL workspace.
  const customFields = normalizeCustomFields(customFieldsRaw)

  const required: Array<[keyof ExtractedEvent | `patient.${keyof ExtractedEvent['patient']}`, string]> = [
    ['plano', config.field_map_plano],
    ['tussCode', config.field_map_procedimento_tuss],
    ['medicoIdentifier', config.field_map_medico_identifier],
    ['patient.fullName', config.field_map_patient_name],
    ['patient.cpf', config.field_map_patient_cpf],
  ]

  const missing: string[] = []
  const values: Record<string, string | undefined> = {}
  for (const [outKey, fieldName] of required) {
    const v = customFields[fieldName]
    if (typeof v !== 'string' || v.trim() === '') {
      missing.push(fieldName)
    } else {
      values[outKey] = v
    }
  }

  if (missing.length > 0) {
    throw new WebhookPayloadError(`Missing required GHL custom fields: ${missing.join(', ')}`, {
      missing_fields: missing,
    })
  }

  const optionalStr = (fieldName: string): string | undefined => {
    const v = customFields[fieldName]
    return typeof v === 'string' && v.trim() !== '' ? v : undefined
  }

  const appointmentAtField = config.field_map_appointment_timestamp
  const appointmentAt =
    (appointmentAtField ? optionalStr(appointmentAtField) : undefined) ?? body.occurred_at

  return {
    ghlEventId: body.event_id,
    ghlContactId: body.contact.id,
    occurredAt: body.occurred_at,
    appointmentAt,
    triggerStageName: body.pipeline?.stage_name,
    plano: values['plano']!,
    tussCode: values['tussCode']!,
    medicoIdentifier: values['medicoIdentifier']!,
    patient: {
      fullName: values['patient.fullName']!,
      cpf: values['patient.cpf']!,
      phone: optionalStr(config.field_map_patient_phone),
      email: optionalStr(config.field_map_patient_email),
      birthDate: optionalStr(config.field_map_patient_birth_date),
    },
  }
}

function normalizeCustomFields(input: unknown): Record<string, unknown> {
  if (Array.isArray(input)) {
    const out: Record<string, unknown> = {}
    for (const entry of input) {
      if (entry && typeof entry === 'object') {
        const rec = entry as Record<string, unknown>
        const key = (rec['name'] ?? rec['key'] ?? rec['id']) as unknown
        if (typeof key === 'string') out[key] = rec['value']
      }
    }
    return out
  }
  if (input && typeof input === 'object') return input as Record<string, unknown>
  return {}
}

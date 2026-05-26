import { z } from 'zod'
import type { IntegrationAdapter, AdapterContext, DomainEvent } from '../types'

/**
 * Generic webhook adapter — fire-and-forget POST of domain events to any
 * configured URL. Optional Bearer token. Useful for customers that want to
 * plug their own data lake, Zapier, n8n, or a bespoke backend without the
 * Clinni team having to ship a dedicated provider.
 */

const eventTypes = z.enum([
  'patient.created',
  'appointment.created',
  'appointment.reversed',
])

export const genericWebhookConfigSchema = z.object({
  outbound_url: z.string().url(),
  events: z.array(eventTypes).min(1),
})
export type GenericWebhookConfig = z.infer<typeof genericWebhookConfigSchema>

export const genericWebhookCredentialsSchema = z.object({
  bearer_token: z.string().min(8).max(256).optional(),
})
export type GenericWebhookCredentials = z.infer<typeof genericWebhookCredentialsSchema>

function redact(c: GenericWebhookCredentials): Record<string, string> {
  return { bearer_token: c.bearer_token ? '***' : '(unset)' }
}

export const genericWebhookAdapter: IntegrationAdapter<
  GenericWebhookConfig,
  GenericWebhookCredentials
> = {
  provider: 'generic_webhook',
  label: 'Webhook genérico',
  description:
    'Dispara POST JSON para uma URL configurada a cada evento do Clinni (patient.created, appointment.created, appointment.reversed).',
  configSchema: genericWebhookConfigSchema,
  credentialsSchema: genericWebhookCredentialsSchema,
  redactCredentials: redact,

  async handleDomainEvent(
    ctx: AdapterContext<GenericWebhookConfig, GenericWebhookCredentials>,
    event: DomainEvent,
  ): Promise<void> {
    if (!ctx.config.events.includes(event.type)) {
      // Event type filtered out by tenant config — success noop.
      return
    }

    const body = {
      event: event.type,
      tenant_id: ctx.tenantId,
      dispatched_at: ctx.now().toISOString(),
      payload: serializeEvent(event),
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (ctx.credentials.bearer_token) {
      headers.authorization = `Bearer ${ctx.credentials.bearer_token}`
    }

    const res = await fetch(ctx.config.outbound_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      throw new Error(`generic_webhook: ${res.status} from ${ctx.config.outbound_url}`)
    }
  },
}

function serializeEvent(event: DomainEvent): Record<string, unknown> {
  // Shape mirrors the DomainEvent discriminated union but with stable JSON
  // field names (snake_case) — so external consumers don't have to care about
  // our TS naming. PII lives in the event object; consumers should treat the
  // payload as sensitive and transport it over TLS only.
  switch (event.type) {
    case 'patient.created':
      return { patient: snakePatient(event.patient) }
    case 'appointment.created':
      return {
        appointment: snakeAppointment(event.appointment),
        patient: snakePatient(event.patient),
      }
    case 'appointment.reversed':
      return {
        original: snakeAppointment(event.original),
        reversal: snakeAppointment(event.reversal),
        reason: event.reason,
      }
  }
}

function snakePatient(p: {
  id: string
  tenantId: string
  fullName: string
  cpf: string
  email: string | null
  phone: string | null
  birthDate: string | null
  planId: string | null
  ghlContactId: string | null
}): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: p.tenantId,
    full_name: p.fullName,
    cpf: p.cpf,
    email: p.email,
    phone: p.phone,
    birth_date: p.birthDate,
    plan_id: p.planId,
    ghl_contact_id: p.ghlContactId,
  }
}

function snakeAppointment(a: {
  id: string
  tenantId: string
  patientId: string
  doctorId: string
  procedureId: string
  procedureTussCode: string
  planId: string | null
  appointmentAt: string
  frozenAmountCents: number
  source: 'ghl' | 'manual'
}): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: a.tenantId,
    patient_id: a.patientId,
    doctor_id: a.doctorId,
    procedure_id: a.procedureId,
    procedure_tuss_code: a.procedureTussCode,
    plan_id: a.planId,
    appointment_at: a.appointmentAt,
    frozen_amount_cents: a.frozenAmountCents,
    source: a.source,
  }
}

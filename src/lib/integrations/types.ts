import type { z } from 'zod'
import type { Logger } from 'pino'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type ProviderId =
  | 'ghl'
  | 'hubspot'
  | 'rdstation'
  | 'pipedrive'
  | 'generic_webhook'

export interface PatientSnapshot {
  id: string
  tenantId: string
  fullName: string
  cpf: string
  email: string | null
  phone: string | null
  birthDate: string | null
  planId: string | null
  ghlContactId: string | null
}

export interface AppointmentSnapshot {
  id: string
  tenantId: string
  patientId: string
  doctorId: string
  procedureId: string
  procedureTussCode: string
  /** Null em atendimento particular. */
  planId: string | null
  appointmentAt: string
  frozenAmountCents: number
  source: 'ghl' | 'manual'
}

export type DomainEvent =
  | { type: 'patient.created'; patient: PatientSnapshot }
  | {
      type: 'appointment.created'
      appointment: AppointmentSnapshot
      patient: PatientSnapshot
    }
  | {
      type: 'appointment.reversed'
      original: AppointmentSnapshot
      reversal: AppointmentSnapshot
      reason: string
    }

export interface AdapterContext<Config = unknown, Credentials = unknown> {
  tenantId: string
  provider: ProviderId
  config: Config
  credentials: Credentials
  /**
   * Supabase client for the adapter to write back integration-specific state
   * (e.g. GHL writes `patients.ghl_contact_id` after a successful contact
   * create). Adapters MUST only touch rows of the tenant in `tenantId`.
   */
  supabase: SupabaseClient<Database>
  logger: Logger
  now: () => Date
}

export interface IntegrationAdapter<Config = unknown, Credentials = unknown> {
  provider: ProviderId
  label: string
  description: string
  configSchema: z.ZodType<Config>
  credentialsSchema: z.ZodType<Credentials>
  redactCredentials(c: Credentials): Record<string, string>
  /**
   * Adapter owns the full inbound webhook flow for its provider: tenant
   * identification (often intertwined with signature verification, so it
   * can't be separated upstream), payload persistence, and queuing. Given
   * just the supabase client and the raw request, returns the HTTP response
   * to send back to the caller. Router in /api/webhooks/[provider]/route.ts
   * 404s when this is not implemented.
   */
  handleInboundWebhook?(
    supabase: SupabaseClient<Database>,
    req: Request,
  ): Promise<Response>
  handleDomainEvent(
    ctx: AdapterContext<Config, Credentials>,
    event: DomainEvent,
  ): Promise<void>
}

export interface DispatchResult {
  provider: ProviderId
  ok: boolean
  detail: string
}

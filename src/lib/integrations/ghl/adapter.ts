import { z } from 'zod'
import type { IntegrationAdapter, AdapterContext, DomainEvent } from '../types'
import { createContactInGhl } from './create-contact'
import { createNoteInGhl } from './create-note'

// Public config shape — safe to return in GET /api/configuracoes/integracoes/ghl
export const ghlConfigSchema = z.object({
  location_id: z
    .string()
    .regex(/^[A-Za-z0-9]{10,40}$/, 'Location ID deve ter 10–40 caracteres alfanuméricos'),
  trigger_stage_name: z.string().trim().min(1).max(100),
  field_map_plano: z.string().trim().min(1).max(60),
  field_map_procedimento_tuss: z.string().trim().min(1).max(60),
  field_map_profissional: z.string().trim().min(1).max(60),
  field_map_valor: z.string().trim().max(60),
})
export type GhlConfig = z.infer<typeof ghlConfigSchema>

// Secret shape — NEVER returned in GET, always cifrado em tenant_integrations.credentials_enc
export const ghlCredentialsSchema = z.object({
  operations_pat: z.string().min(10).max(200),
  inbound_webhook_secret: z.string().min(32).max(128),
})
export type GhlCredentials = z.infer<typeof ghlCredentialsSchema>

function redact(c: GhlCredentials): Record<string, string> {
  return {
    operations_pat: '***',
    inbound_webhook_secret: '***',
  }
}

/**
 * GHL adapter. P3 responsibilities (handleDomainEvent wiring patient/appointment
 * events to the Homio-Operations proxy) land in T039. For US2 (this PR) the
 * adapter is registered with a noop handler so connect/disconnect UX + auditing
 * can ship before outbound fan-out is turned on.
 */
export const ghlAdapter: IntegrationAdapter<GhlConfig, GhlCredentials> = {
  provider: 'ghl',
  label: 'GoHighLevel',
  description:
    'CRM e automação de marketing. Contato criado no Pronttu é espelhado como contact; atendimento vira nota.',
  configSchema: ghlConfigSchema,
  credentialsSchema: ghlCredentialsSchema,
  redactCredentials: redact,

  async extractTenantIdFromWebhook(_req: Request): Promise<string | null> {
    // US2 ships without the inbound-routing refactor (that's P4 / T046–T048).
    // The legacy /api/webhooks/ghl/route.ts still resolves tenant via HMAC
    // secret matching — this method is a placeholder for the polish phase.
    return null
  },

  async handleDomainEvent(
    ctx: AdapterContext<GhlConfig, GhlCredentials>,
    event: DomainEvent,
  ): Promise<void> {
    // US2 noop — see T039 (US3) for the real implementation. Exposing the
    // dispatch path here would fire real HTTP calls before the dispatcher
    // decrypts credentials and times out correctly.
    //
    // Shape-test still exercises this method for type safety.
    switch (event.type) {
      case 'patient.created':
      case 'appointment.created':
      case 'appointment.reversed':
        ctx.logger.debug({ provider: 'ghl', event: event.type }, 'ghl-adapter-noop')
        return
    }
  },
}

// Keep utility exports available for the US3 wiring and for tests.
export { createContactInGhl, createNoteInGhl }

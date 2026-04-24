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
    const proxyCreds = buildProxyCreds(ctx)

    switch (event.type) {
      case 'patient.created': {
        const out = await createContactInGhl(
          {
            fullName: event.patient.fullName,
            phone: event.patient.phone ?? undefined,
            email: event.patient.email ?? undefined,
            source: 'pronttu:manual',
          },
          proxyCreds,
        )
        if (!out.configured) {
          throw new Error('ghl_proxy_not_configured: operations_url/key missing')
        }
        // Write back the contact id so future events (appointment.created)
        // know where to attach the note.
        const upd = await ctx.supabase
          .from('patients')
          .update({ ghl_contact_id: out.ghlContactId })
          .eq('id', event.patient.id)
          .eq('tenant_id', ctx.tenantId)
        if (upd.error) {
          throw new Error(`patients.ghl_contact_id update failed: ${upd.error.message}`)
        }
        return
      }

      case 'appointment.created': {
        if (!event.patient.ghlContactId) {
          // Patient was created before GHL was connected (or sync failed).
          // No contact to attach a note to — treat as success with a noop.
          ctx.logger.info(
            { patient_id: event.patient.id },
            'ghl-adapter-skip-note-no-contact',
          )
          return
        }
        await createNoteInGhl(
          {
            contactId: event.patient.ghlContactId,
            body: formatAppointmentNote(event),
          },
          proxyCreds,
        )
        return
      }

      case 'appointment.reversed': {
        // US3 scope: just log. Full reversal note wire-up is polish.
        ctx.logger.debug(
          { appointment_id: event.original.id },
          'ghl-adapter-skip-reversal-note',
        )
        return
      }
    }
  },
}

// Keep utility exports available for the US3 wiring and for tests.
export { createContactInGhl, createNoteInGhl }

function buildProxyCreds(
  ctx: AdapterContext<GhlConfig, GhlCredentials>,
): { operationsUrl?: string; operationsKey?: string; locationId: string } {
  // URL of the Homio-Operations proxy + bearer key are infra-shared across
  // tenants (one Edge Function serves all tenants); they still live in env
  // vars. Per-tenant bits are `location_id` (config) and `operations_pat`
  // (credentials). The PAT is currently forwarded as the Bearer to the proxy
  // when operationsKey env var is absent.
  const envKey = process.env.SUPABASE_OPERATIONS_ANON_KEY
  return {
    operationsUrl: process.env.SUPABASE_OPERATIONS_URL,
    operationsKey: envKey ?? ctx.credentials.operations_pat,
    locationId: ctx.config.location_id,
  }
}

function formatAppointmentNote(event: {
  appointment: { appointmentAt: string; frozenAmountCents: number; procedureTussCode: string }
  patient: { fullName: string }
}): string {
  const when = new Date(event.appointment.appointmentAt)
  const valueBrl = (event.appointment.frozenAmountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
  return [
    'Atendimento registrado no Pronttu',
    `Data: ${when.toLocaleString('pt-BR')}`,
    `Paciente: ${event.patient.fullName}`,
    event.appointment.procedureTussCode
      ? `Procedimento (TUSS): ${event.appointment.procedureTussCode}`
      : '',
    `Valor: ${valueBrl}`,
  ]
    .filter(Boolean)
    .join('\n')
}

import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'
import type { IntegrationAdapter, AdapterContext, DomainEvent } from '../types'
import { createContactInGhl } from './create-contact'
import { createNoteInGhl } from './create-note'
import { verifyGhlSignature } from './verify-signature'
import { ingestRawEvent } from '@/lib/core/webhooks/ingest-raw-event'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { enqueueGhlEvent } from '@/lib/integrations/queue/qstash-client'
import { InvalidSignatureError } from '@/lib/observability/errors'
import { mintTraceId } from '@/lib/observability/trace'
import { logger } from '@/lib/observability/logger'

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

  async handleInboundWebhook(
    supabase: SupabaseClient<Database>,
    req: Request,
  ): Promise<Response> {
    return handleGhlWebhook(supabase, req)
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

// ---------------------------------------------------------------------------
// Inbound webhook handling (ported from src/app/api/webhooks/ghl/route.ts).
// Identifies the tenant by scanning tenant_integrations rows with
// provider='ghl', decrypting webhook_secret_enc, and matching the HMAC.
// ---------------------------------------------------------------------------

const payloadShape = z.object({ event_id: z.string().min(1) }).passthrough()

async function handleGhlWebhook(
  supabase: SupabaseClient<Database>,
  req: Request,
): Promise<Response> {
  const traceId = mintTraceId()
  const signature = req.headers.get('x-ghl-signature')
  const timestamp = req.headers.get('x-ghl-timestamp')

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Body is not readable' } },
      { status: 400 },
    )
  }

  const parsed = tryParse(rawBody)
  if (!parsed) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Body is not valid JSON' } },
      { status: 400 },
    )
  }
  const shape = payloadShape.safeParse(parsed)
  if (!shape.success) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_EVENT_ID',
          message: 'event_id is required',
          issues: shape.error.issues,
        },
      },
      { status: 400 },
    )
  }
  const ghlEventId = shape.data.event_id

  const tenantId = await identifyTenantBySignature(supabase, {
    signature,
    timestamp,
    rawBody,
  })

  if (!tenantId) {
    await notifySignatureFailure(supabase, { ghlEventId, traceId })
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
      { status: 401 },
    )
  }

  const headersObj: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    if (k === 'x-ghl-signature' || k === 'x-ghl-timestamp' || k === 'authorization') return
    headersObj[k] = v
  })

  const { rawEventId, duplicate } = await ingestRawEvent(supabase, {
    tenantId,
    ghlEventId,
    payload: parsed as Json,
    headers: headersObj as Json,
  })

  if (!duplicate) enqueueBestEffort({ rawEventId, tenantId, traceId })

  logger.info(
    { trace_id: traceId, tenant_id: tenantId, raw_event_id: rawEventId, duplicate },
    'ghl-webhook-received',
  )

  return NextResponse.json(
    { received: true, duplicate, raw_event_id: rawEventId },
    { status: 200, headers: { 'x-trace-id': traceId } },
  )
}

function tryParse(body: string): unknown | null {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function identifyTenantBySignature(
  supabase: SupabaseClient<Database>,
  args: { signature: string | null; timestamp: string | null; rawBody: string },
): Promise<string | null> {
  if (!args.signature || !args.timestamp) return null

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY missing')

  // Scan tenant_integrations rows for provider='ghl'. `webhook_secret_enc` is
  // the HMAC key, stored in a dedicated column alongside config/credentials.
  const { data: configs, error } = await supabase
    .from('tenant_integrations')
    .select('tenant_id, webhook_secret_enc')
    .eq('provider', 'ghl')
    .eq('enabled', true)
  if (error) throw new Error(`tenant_integrations scan failed: ${error.message}`)
  if (!configs || configs.length === 0) return null

  for (const cfg of configs) {
    if (!cfg.webhook_secret_enc) continue
    const { data: decrypted, error: decErr } = await supabase.rpc('dec_text_with_key', {
      cipher: cfg.webhook_secret_enc as unknown as string,
      key,
    })
    if (decErr || typeof decrypted !== 'string') continue
    try {
      verifyGhlSignature({
        signature: args.signature,
        timestamp: args.timestamp,
        rawBody: args.rawBody,
        secret: decrypted,
      })
      return cfg.tenant_id
    } catch (err) {
      if (err instanceof InvalidSignatureError) continue
      throw err
    }
  }
  return null
}

async function notifySignatureFailure(
  supabase: SupabaseClient<Database>,
  ctx: { ghlEventId: string; traceId: string },
): Promise<void> {
  const { data: tenants, error } = await supabase
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('provider', 'ghl')
    .eq('enabled', true)
  if (error || !tenants) return
  for (const { tenant_id: tenantId } of tenants) {
    try {
      await dispatchAlert({
        tenantId,
        type: 'signature_failure',
        subjectRef: { ghl_event_id: ctx.ghlEventId },
        detail: { ghl_event_id: ctx.ghlEventId, trace_id: ctx.traceId, provider: 'ghl' },
      })
    } catch (err) {
      logger.error({ err, tenant_id: tenantId }, 'signature-failure-alert-dispatch-failed')
    }
  }
}

function enqueueBestEffort(args: { rawEventId: string; tenantId: string; traceId: string }): void {
  if (process.env.NODE_ENV === 'test' || !process.env.QSTASH_TOKEN) return
  enqueueGhlEvent(args).catch((err: unknown) => {
    logger.error({ err, ...args }, 'qstash-enqueue-failed-after-durable-write')
  })
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
    `Data: ${when.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    `Paciente: ${event.patient.fullName}`,
    event.appointment.procedureTussCode
      ? `Procedimento (TUSS): ${event.appointment.procedureTussCode}`
      : '',
    `Valor: ${valueBrl}`,
  ]
    .filter(Boolean)
    .join('\n')
}

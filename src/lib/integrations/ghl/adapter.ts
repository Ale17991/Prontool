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
import { withGhlAuth } from './oauth/with-auth'
import {
  ghlConfigV2Schema,
  ghlOAuthCredentialsSchema,
  type GhlConfigV2,
  type GhlOAuthCredentials,
} from './oauth/types'
import { recordSyncSuccess, recordSyncFailure } from '@/lib/core/integrations/ghl/sync-log'

/**
 * Feature 008 — GHL adapter v2: OAuth direto contra services.leadconnectorhq.com.
 *
 * Substitui o caminho proxy (Homio Operations) por chamada Bearer com
 * `withGhlAuth` por trás (auto-refresh + token_expired handling). Mantém
 * a interface `IntegrationAdapter` da Feature 002 — registry e dispatcher
 * não mudam.
 *
 * `redactCredentials` retorna apenas campos seguros: `expires_at`, `scopes`,
 * `location_id`. Tokens NUNCA aparecem.
 */

function redact(_c: GhlOAuthCredentials): Record<string, string> {
  // Nenhum campo de credentials é ecoado — todos viram sentinela. Metadata
  // não-sensível (sub_account_name, scopes concedidos, expires_at) fica em
  // `tenant_integrations.config` e em audit_log, NÃO em credentials_enc.
  return {
    access_token: '***',
    refresh_token: '***',
    expires_at: '***',
    scopes: '***',
    location_id: '***',
    company_id: '***',
    user_id: '***',
    user_type: '***',
  }
}

export const ghlAdapter: IntegrationAdapter<GhlConfigV2, GhlOAuthCredentials> = {
  provider: 'ghl',
  label: 'Homio',
  description:
    'CRM e automação de marketing Homio. Contato sincronizado via OAuth 2.0; atendimento vira nota.',
  configSchema: ghlConfigV2Schema as unknown as z.ZodType<GhlConfigV2>,
  credentialsSchema: ghlOAuthCredentialsSchema as unknown as z.ZodType<GhlOAuthCredentials>,
  redactCredentials: redact,

  async handleInboundWebhook(supabase: SupabaseClient<Database>, req: Request): Promise<Response> {
    return handleGhlWebhook(supabase, req)
  },

  async handleDomainEvent(
    ctx: AdapterContext<GhlConfigV2, GhlOAuthCredentials>,
    event: DomainEvent,
  ): Promise<void> {
    // withGhlAuth re-lê tokens e refresca se necessário. Em token_expired
    // grava sync-log e retorna sem tentar GHL (operação local concluiu).
    const auth = await withGhlAuth(ctx.supabase, ctx.tenantId)
    if (auth.kind !== 'connected') {
      await recordSyncFailure(ctx.supabase, ctx.tenantId, {
        kind: kindFor(event),
        errorCode: auth.kind === 'token_expired' ? 'TOKEN_EXPIRED' : 'NOT_CONNECTED',
        errorMessage:
          auth.kind === 'token_expired'
            ? 'Refresh token revoked or invalid; reconnect required.'
            : 'No active GHL integration for this tenant.',
        detail: { event_type: event.type },
      })
      return
    }

    switch (event.type) {
      case 'patient.created': {
        try {
          const out = await createContactInGhl({
            accessToken: auth.accessToken,
            locationId: ctx.config.location_id,
            customFieldIds: ctx.config.custom_field_ids,
            patient: {
              fullName: event.patient.fullName,
              email: event.patient.email,
              phone: event.patient.phone,
              cpf: event.patient.cpf,
            },
          })
          // Write back so future appointment events can attach notes.
          const upd = await ctx.supabase
            .from('patients')
            .update({ ghl_contact_id: out.ghlContactId })
            .eq('id', event.patient.id)
            .eq('tenant_id', ctx.tenantId)
          if (upd.error) {
            throw new Error(`patients.ghl_contact_id update failed: ${upd.error.message}`)
          }
          await recordSyncSuccess(ctx.supabase, ctx.tenantId, {
            kind: 'outbound_contact',
            detail: { patient_id: event.patient.id, ghl_contact_id: out.ghlContactId },
          })
        } catch (err) {
          await recordSyncFailure(ctx.supabase, ctx.tenantId, {
            kind: 'outbound_contact',
            errorCode: 'GHL_OUTBOUND_FAILED',
            errorMessage: err instanceof Error ? err.message : String(err),
            detail: { patient_id: event.patient.id },
          })
          throw err // propaga para dispatcher (que dispatchAlert).
        }
        return
      }

      case 'appointment.created': {
        if (!event.patient.ghlContactId) {
          // Patient pre-dates the connection or sync failed; skip.
          ctx.logger.info({ patient_id: event.patient.id }, 'ghl-adapter-skip-note-no-contact')
          return
        }
        try {
          await createNoteInGhl({
            accessToken: auth.accessToken,
            contactId: event.patient.ghlContactId,
            body: formatAppointmentNote(event),
          })
          await recordSyncSuccess(ctx.supabase, ctx.tenantId, {
            kind: 'outbound_note',
            detail: {
              appointment_id: event.appointment.id,
              ghl_contact_id: event.patient.ghlContactId,
            },
          })
        } catch (err) {
          await recordSyncFailure(ctx.supabase, ctx.tenantId, {
            kind: 'outbound_note',
            errorCode: 'GHL_OUTBOUND_FAILED',
            errorMessage: err instanceof Error ? err.message : String(err),
            detail: { appointment_id: event.appointment.id },
          })
          throw err
        }
        return
      }

      case 'appointment.reversed': {
        // Out of v1 scope — log only.
        ctx.logger.debug({ appointment_id: event.original.id }, 'ghl-adapter-skip-reversal-note')
        return
      }
    }
  },
}

export { createContactInGhl, createNoteInGhl }

function kindFor(event: DomainEvent): 'outbound_contact' | 'outbound_note' | 'outbound_update' {
  switch (event.type) {
    case 'patient.created':
      return 'outbound_contact'
    case 'appointment.created':
      return 'outbound_note'
    default:
      return 'outbound_update'
  }
}

// ---------------------------------------------------------------------------
// Inbound webhook handling — mantido do legado, scaneia tenant_integrations
// pra identificar tenant via `webhook_secret_enc`.
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
    'Atendimento registrado no Clinni',
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

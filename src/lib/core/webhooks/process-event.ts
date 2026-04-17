import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'
import { createAppointmentFromEvent } from '@/lib/core/appointments/create-from-event'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import type { AlertType } from '@/lib/db/types'

/**
 * T083 — drive a raw webhook event through its processing lifecycle:
 *   pending → processing → done | dlq
 *
 * Terminal outcomes (done / dlq) return normally so QStash stops retrying.
 * Transient/unknown errors are re-thrown so QStash can back off and retry.
 *
 * All `DomainError`s are treated as terminal — they are modelling states
 * the operator needs to fix (wrong field map, retired TUSS, missing
 * price/plan/doctor). A retry without human action won't succeed.
 */
export interface ProcessEventInput {
  rawEventId: string
  traceId?: string
}

export interface ProcessEventResult {
  status: 'done' | 'dlq'
  appointmentId?: string
  failureCode?: string
}

export async function processWebhookEvent(
  supabase: SupabaseClient<Database>,
  input: ProcessEventInput,
): Promise<ProcessEventResult> {
  const raw = await supabase
    .from('raw_webhook_events')
    .select('id, tenant_id, processing_status, processing_attempt_count')
    .eq('id', input.rawEventId)
    .single()
  if (raw.error || !raw.data) throw new NotFoundError('raw_webhook_events', input.rawEventId)

  // Already terminal — don't double-process. QStash duplicate deliveries land
  // here when a retry is in flight while the first attempt completed.
  if (raw.data.processing_status === 'done' || raw.data.processing_status === 'dlq') {
    return { status: raw.data.processing_status as 'done' | 'dlq' }
  }

  await transition(supabase, raw.data.tenant_id, input.rawEventId, {
    from: raw.data.processing_status,
    to: 'processing',
    reason: 'worker-picked-up',
  })

  try {
    const result = await createAppointmentFromEvent(supabase, {
      rawEventId: input.rawEventId,
    })
    await transition(supabase, raw.data.tenant_id, input.rawEventId, {
      from: 'processing',
      to: 'done',
      reason: 'appointment-created',
    })
    logger.info(
      {
        trace_id: input.traceId,
        raw_event_id: input.rawEventId,
        tenant_id: raw.data.tenant_id,
        appointment_id: result.appointmentId,
      },
      'webhook-event-processed',
    )
    return { status: 'done', appointmentId: result.appointmentId }
  } catch (err) {
    if (err instanceof DomainError) {
      await routeToDlq(supabase, raw.data.tenant_id, input.rawEventId, err, input.traceId)
      return { status: 'dlq', failureCode: err.code }
    }
    // Transient/unknown — let QStash retry.
    logger.error(
      {
        err,
        trace_id: input.traceId,
        raw_event_id: input.rawEventId,
        tenant_id: raw.data.tenant_id,
      },
      'webhook-event-transient-failure',
    )
    throw err
  }
}

async function transition(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  rawEventId: string,
  t: { from: string | null; to: string; reason: string },
): Promise<void> {
  const { error: upErr } = await supabase
    .from('raw_webhook_events')
    .update({
      processing_status: t.to,
      last_processed_at: new Date().toISOString(),
    })
    .eq('id', rawEventId)
  if (upErr) throw new Error(`raw_webhook_events update failed: ${upErr.message}`)

  const { error: trErr } = await supabase.from('webhook_event_transitions').insert({
    tenant_id: tenantId,
    raw_event_id: rawEventId,
    from_status: t.from,
    to_status: t.to,
    reason: t.reason,
    actor: 'worker:process-ghl-event',
  })
  if (trErr) throw new Error(`webhook_event_transitions insert failed: ${trErr.message}`)
}

async function routeToDlq(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  rawEventId: string,
  err: DomainError,
  traceId: string | undefined,
): Promise<void> {
  await transition(supabase, tenantId, rawEventId, {
    from: 'processing',
    to: 'dlq',
    reason: err.code,
  })

  const alertType = alertTypeForDomainError(err.code)
  await dispatchAlert({
    tenantId,
    type: alertType,
    subjectRef: { raw_event_id: rawEventId, failure_code: err.code },
    detail: {
      raw_event_id: rawEventId,
      failure_reason: err.code,
      ...(err.meta ?? {}),
    },
  })

  logger.warn(
    {
      trace_id: traceId,
      raw_event_id: rawEventId,
      tenant_id: tenantId,
      failure_code: err.code,
    },
    'webhook-event-routed-to-dlq',
  )
}

function alertTypeForDomainError(code: string): AlertType {
  switch (code) {
    case 'WEBHOOK_PAYLOAD_INVALID':
    case 'VALIDATION_FAILED':
    case 'TUSS_CODE_UNKNOWN':
    case 'TUSS_CODE_RETIRED':
    case 'PLAN_UNKNOWN':
    case 'DOCTOR_UNKNOWN':
    case 'APPOINTMENT_PRICE_MISSING':
    case 'COMMISSION_MISSING':
      return 'webhook_rejected'
    default:
      return 'dlq_event'
  }
}

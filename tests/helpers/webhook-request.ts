import { createHmac } from 'node:crypto'

/**
 * Canonical signing form pinned by the contract tests: HMAC-SHA256 of
 * `${timestamp}.${rawBody}` using the tenant's webhook_secret. Keep this in
 * sync with `src/lib/integrations/ghl/verify-signature.ts` (T076).
 */
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret'

export interface SignedRequestOptions {
  secret?: string
  timestamp?: string
  signature?: string
  url?: string
}

export function buildSignedWebhookRequest(body: unknown, opts: SignedRequestOptions = {}): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const secret = opts.secret ?? TEST_WEBHOOK_SECRET
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString()
  const signature = opts.signature ?? signPayload(secret, timestamp, raw)
  return new Request(opts.url ?? 'http://localhost/api/webhooks/ghl', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ghl-signature': signature,
      'x-ghl-timestamp': timestamp,
    },
    body: raw,
  })
}

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

/**
 * Standard happy-path GHL webhook payload shape used by the integration
 * tests. Custom fields map to the field names seeded by `seedGhlConfig`.
 */
export function buildValidGhlPayload(overrides: Partial<GhlTestPayload> = {}): GhlTestPayload {
  return {
    event_id: overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
    event_type: overrides.event_type ?? 'pipeline_stage_changed',
    occurred_at: overrides.occurred_at ?? new Date().toISOString(),
    contact: overrides.contact ?? {
      id: 'ghl_contact_abc',
      custom_fields: {
        plano: 'Unimed',
        tuss: '10101012',
        medico_id: 'CRM-12345',
        patient_name: 'Maria Teste',
        patient_cpf: '12345678900',
        patient_phone: '+5511999999999',
        patient_email: 'maria@test.local',
        patient_birth_date: '1990-03-15',
      },
    },
    pipeline: overrides.pipeline ?? { id: 'p1', stage_name: 'atendimento' },
  }
}

export interface GhlTestPayload {
  event_id: string
  event_type: string
  occurred_at: string
  contact: {
    id: string
    custom_fields: Record<string, string>
  }
  pipeline: { id: string; stage_name: string }
}

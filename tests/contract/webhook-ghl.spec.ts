/**
 * T061 — Contract test for POST /api/webhooks/ghl.
 *
 * Validates the request/response shape declared in
 * `specs/001-faturamento-medico-ghl/contracts/webhook-ghl.yaml` and pins the
 * existence of the Route Handler module. Happy-path behavior (DB side-effects,
 * idempotency, DLQ routing) belongs to the integration tests (T063–T070).
 *
 * Red-first: the "handler module exists" test fails until T084 lands.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import {
  loadContract,
  assertPathExists,
  assertResponseCodes,
  type OpenApiSpec,
} from '@/tests/helpers/contract-runner'

const CONTRACT_PATH = resolve(
  process.cwd(),
  'specs/001-faturamento-medico-ghl/contracts/webhook-ghl.yaml',
)
const ENDPOINT = '/api/webhooks/ghl'

interface OpenApiOperation {
  parameters?: Array<{ name: string; in: string; required?: boolean }>
  requestBody?: { content?: Record<string, { schema?: unknown }> }
  responses?: Record<
    string,
    {
      content?: Record<
        string,
        {
          schema?: {
            required?: string[]
            properties?: Record<string, { type?: string; format?: string }>
          }
        }
      >
    }
  >
}

interface OpenApiSchema {
  required?: string[]
  properties?: Record<string, { type?: string; description?: string }>
}

function getOperation(spec: OpenApiSpec): OpenApiOperation {
  const path = spec.paths[ENDPOINT] as Record<string, OpenApiOperation> | undefined
  if (!path?.post) throw new Error(`Missing POST ${ENDPOINT} in contract`)
  return path.post
}

describe('contract: POST /api/webhooks/ghl', () => {
  let spec: OpenApiSpec

  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares POST /api/webhooks/ghl', () => {
      assertPathExists(spec, ENDPOINT, 'post')
    })

    it('declares 200, 400, 401, and 5XX responses', () => {
      assertResponseCodes(spec, ENDPOINT, 'post', ['200', '400', '401', '5XX'])
    })

    it('requires X-GHL-Signature and X-GHL-Timestamp headers', () => {
      const op = getOperation(spec)
      const requiredHeaders = (op.parameters ?? [])
        .filter((p) => p.in === 'header' && p.required === true)
        .map((p) => p.name)
      expect(requiredHeaders).toContain('X-GHL-Signature')
      expect(requiredHeaders).toContain('X-GHL-Timestamp')
    })

    it('request body requires event_id, event_type, contact', () => {
      const payloadSchema = spec.components?.schemas?.GhlWebhookPayload as OpenApiSchema | undefined
      expect(payloadSchema?.required).toEqual(
        expect.arrayContaining(['event_id', 'event_type', 'contact']),
      )
    })

    it('200 response body requires received, duplicate, raw_event_id', () => {
      const op = getOperation(spec)
      const schema = op.responses?.['200']?.content?.['application/json']?.schema as
        | OpenApiSchema
        | undefined
      expect(schema?.required).toEqual(
        expect.arrayContaining(['received', 'duplicate', 'raw_event_id']),
      )
      expect(schema?.properties?.received?.type).toBe('boolean')
      expect(schema?.properties?.duplicate?.type).toBe('boolean')
      expect(schema?.properties?.raw_event_id?.type).toBe('string')
    })
  })

  describe('Route Handler module', () => {
    it('exports POST from src/app/api/webhooks/ghl/route.ts', async () => {
      // Behavioral assertions (DB writes, idempotency, 401 on bad signature)
      // live in tests/integration/webhook-*.spec.ts (T063–T070).
      const mod = await import('@/app/api/webhooks/ghl/route')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
  })
})

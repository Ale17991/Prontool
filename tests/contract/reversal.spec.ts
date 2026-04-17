/**
 * T062 — Contract test for POST /api/atendimentos/{id}/reversal.
 *
 * Validates the reversal slice of `contracts/atendimentos.yaml` and pins the
 * Route Handler module. Behavioral assertions (409 on duplicate, RBAC 403,
 * effective_status transition) live in T071–T073.
 *
 * Red-first: handler-existence test fails until T088b lands.
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
  'specs/001-faturamento-medico-ghl/contracts/atendimentos.yaml',
)
const ENDPOINT = '/api/atendimentos/{id}/reversal'

interface OpenApiOperation {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
  requestBody?: { content?: Record<string, { schema?: { required?: string[] } }> }
}

describe('contract: POST /api/atendimentos/{id}/reversal', () => {
  let spec: OpenApiSpec

  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares POST /api/atendimentos/{id}/reversal', () => {
      assertPathExists(spec, ENDPOINT, 'post')
    })

    it('declares 201, 403, 404, 409 responses', () => {
      assertResponseCodes(spec, ENDPOINT, 'post', ['201', '403', '404', '409'])
    })

    it('request body requires reason', () => {
      const op = (spec.paths[ENDPOINT] as Record<string, OpenApiOperation> | undefined)?.post
      const schema = op?.requestBody?.content?.['application/json']?.schema
      expect(schema?.required).toEqual(expect.arrayContaining(['reason']))
    })
  })

  describe('Route Handler module', () => {
    it('exports POST from src/app/api/atendimentos/[id]/reversal/route.ts', async () => {
      const mod = await import('@/app/api/atendimentos/[id]/reversal/route')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
  })
})

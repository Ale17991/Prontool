/**
 * T100 — Contract test for the precos endpoints.
 *
 * Validates OpenAPI shape of GET /api/precos, POST /api/precos/versions,
 * and GET /api/precos/versions/{id}/history. Pins existence of the Route
 * Handler modules. Behavioral assertions live in T101–T107.
 *
 * Red-first: handler imports fail until T111/T112/T113 land.
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
  'specs/001-faturamento-medico-ghl/contracts/precos.yaml',
)

interface OpenApiSchemaRef {
  required?: string[]
  properties?: Record<string, { type?: string }>
}

describe('contract: precos endpoints', () => {
  let spec: OpenApiSpec
  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares GET /api/precos', () => {
      assertPathExists(spec, '/api/precos', 'get')
    })
    it('declares POST /api/precos/versions with 201, 403, 409', () => {
      assertPathExists(spec, '/api/precos/versions', 'post')
      assertResponseCodes(spec, '/api/precos/versions', 'post', ['201', '403', '409'])
    })
    it('declares GET /api/precos/versions/{id}/history', () => {
      assertPathExists(spec, '/api/precos/versions/{id}/history', 'get')
    })
    it('CreatePriceVersionRequest requires expected_head_id', () => {
      const schema = spec.components?.schemas?.CreatePriceVersionRequest as
        | OpenApiSchemaRef
        | undefined
      expect(schema?.required).toEqual(
        expect.arrayContaining([
          'procedure_id',
          'plan_id',
          'amount_cents',
          'valid_from',
          'reason',
          'expected_head_id',
        ]),
      )
    })
    it('ConflictError carries current_head_id', () => {
      const schema = spec.components?.schemas?.ConflictError as OpenApiSchemaRef | undefined
      expect(schema?.required).toEqual(expect.arrayContaining(['code', 'current_head_id']))
    })
  })

  describe('Route Handler modules', () => {
    it('exports GET from src/app/api/precos/route.ts', async () => {
      // @ts-expect-error — implementation pending (T111)
      const mod = await import('@/app/api/precos/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
    })
    it('exports POST from src/app/api/precos/versions/route.ts', async () => {
      // @ts-expect-error — implementation pending (T112)
      const mod = await import('@/app/api/precos/versions/route')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
    it('exports GET from src/app/api/precos/versions/[id]/history/route.ts', async () => {
      // @ts-expect-error — implementation pending (T113)
      const mod = await import('@/app/api/precos/versions/[id]/history/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
    })
  })
})

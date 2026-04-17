/**
 * T158 — Contract test for procedimentos endpoints.
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
  'specs/001-faturamento-medico-ghl/contracts/procedimentos.yaml',
)

describe('contract: procedimentos endpoints', () => {
  let spec: OpenApiSpec
  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares GET and POST /api/procedimentos', () => {
      assertPathExists(spec, '/api/procedimentos', 'get')
      assertPathExists(spec, '/api/procedimentos', 'post')
      assertResponseCodes(spec, '/api/procedimentos', 'post', ['201', '400', '403', '409'])
    })
    it('declares PATCH /api/procedimentos/{id}', () => {
      assertPathExists(spec, '/api/procedimentos/{id}', 'patch')
      assertResponseCodes(spec, '/api/procedimentos/{id}', 'patch', ['200', '403'])
    })
  })

  describe('Route Handler modules', () => {
    it('exports GET and POST from src/app/api/procedimentos/route.ts', async () => {
      // @ts-expect-error — implementation pending (T164)
      const mod = await import('@/app/api/procedimentos/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
    it('exports PATCH from src/app/api/procedimentos/[id]/route.ts', async () => {
      // @ts-expect-error — implementation pending (T164)
      const mod = await import('@/app/api/procedimentos/[id]/route')
      expect(typeof (mod as { PATCH?: unknown }).PATCH).toBe('function')
    })
  })
})

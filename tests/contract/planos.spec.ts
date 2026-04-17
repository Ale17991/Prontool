/**
 * T159 — Contract test for planos endpoints.
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
  'specs/001-faturamento-medico-ghl/contracts/planos.yaml',
)

describe('contract: planos endpoints', () => {
  let spec: OpenApiSpec
  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares GET and POST /api/planos', () => {
      assertPathExists(spec, '/api/planos', 'get')
      assertPathExists(spec, '/api/planos', 'post')
      assertResponseCodes(spec, '/api/planos', 'post', ['201', '403', '409'])
    })
    it('declares PATCH /api/planos/{id} (rename forbidden — only `active`)', () => {
      assertPathExists(spec, '/api/planos/{id}', 'patch')
    })
  })

  describe('Route Handler modules', () => {
    it('exports GET and POST from src/app/api/planos/route.ts', async () => {
      const mod = await import('@/app/api/planos/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
    it('exports PATCH from src/app/api/planos/[id]/route.ts', async () => {
      const mod = await import('@/app/api/planos/[id]/route')
      expect(typeof (mod as { PATCH?: unknown }).PATCH).toBe('function')
    })
  })
})

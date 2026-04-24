/**
 * T117 — Contract test for médicos endpoints against medicos.yaml.
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
  'specs/001-faturamento-medico-ghl/contracts/medicos.yaml',
)

describe('contract: medicos endpoints', () => {
  let spec: OpenApiSpec
  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares GET and POST /api/medicos', () => {
      assertPathExists(spec, '/api/medicos', 'get')
      assertPathExists(spec, '/api/medicos', 'post')
      assertResponseCodes(spec, '/api/medicos', 'post', ['201', '403'])
    })
    it('declares GET and PATCH /api/medicos/{id}', () => {
      assertPathExists(spec, '/api/medicos/{id}', 'get')
      assertPathExists(spec, '/api/medicos/{id}', 'patch')
      assertResponseCodes(spec, '/api/medicos/{id}', 'get', ['200'])
      assertResponseCodes(spec, '/api/medicos/{id}', 'patch', ['200'])
    })
    it('declares POST /api/medicos/{id}/commission', () => {
      assertPathExists(spec, '/api/medicos/{id}/commission', 'post')
      assertResponseCodes(spec, '/api/medicos/{id}/commission', 'post', ['201', '403'])
    })
  })

  describe('Route Handler modules', () => {
    it('exports GET and POST from src/app/api/medicos/route.ts', async () => {
      const mod = await import('@/app/api/medicos/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
    it('exports GET and PATCH from src/app/api/medicos/[id]/route.ts', async () => {
      const mod = await import('@/app/api/medicos/[id]/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
      expect(typeof (mod as { PATCH?: unknown }).PATCH).toBe('function')
    })
    it('exports POST from src/app/api/medicos/[id]/commission/route.ts', async () => {
      const mod = await import('@/app/api/medicos/[id]/commission/route')
      expect(typeof (mod as { POST?: unknown }).POST).toBe('function')
    })
  })
})

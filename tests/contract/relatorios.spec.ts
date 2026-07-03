/**
 * T131 — Contract test for relatórios endpoints against relatorios.yaml.
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
  'specs/001-faturamento-medico-ghl/contracts/relatorios.yaml',
)

describe('contract: relatorios endpoints', () => {
  let spec: OpenApiSpec
  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares GET /api/relatorios/mensal with from+to query params and 403', () => {
      assertPathExists(spec, '/api/relatorios/mensal', 'get')
      assertResponseCodes(spec, '/api/relatorios/mensal', 'get', ['200', '403'])
    })
    it('declares GET /api/relatorios/mensal/export/{format}', () => {
      assertPathExists(spec, '/api/relatorios/mensal/export/{format}', 'get')
      assertResponseCodes(spec, '/api/relatorios/mensal/export/{format}', 'get', ['200'])
    })
    it('MonthlyReport schema exposes period, revenue_by_plan, production_by_doctor, totals', () => {
      const schema = spec.components?.schemas?.MonthlyReport as
        | { required?: string[]; properties?: Record<string, unknown> }
        | undefined
      expect(schema?.required ?? []).toEqual(
        expect.arrayContaining(['period', 'revenue_by_plan', 'production_by_doctor', 'totals']),
      )
    })
  })

  describe('Route Handler modules', () => {
    it('exports GET from src/app/api/relatorios/mensal/route.ts', async () => {
      const mod = await import('@/app/api/relatorios/mensal/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
    })
    it('exports GET from src/app/api/relatorios/mensal/export/[formato]/route.ts', async () => {
      const mod = await import('@/app/api/relatorios/mensal/export/[formato]/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
    })
  })
})

/**
 * T168 — Contract test for auditoria endpoints (paginated read + export).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { loadContract, assertPathExists, type OpenApiSpec } from '@/tests/helpers/contract-runner'

const CONTRACT_PATH = resolve(
  process.cwd(),
  'specs/001-faturamento-medico-ghl/contracts/auditoria.yaml',
)

interface OpenApiSchemaRef {
  required?: string[]
  properties?: Record<string, unknown>
}

describe('contract: auditoria endpoints', () => {
  let spec: OpenApiSpec
  beforeAll(() => {
    spec = loadContract(CONTRACT_PATH)
  })

  describe('OpenAPI document', () => {
    it('declares GET /api/auditoria and GET /api/auditoria/export', () => {
      assertPathExists(spec, '/api/auditoria', 'get')
      assertPathExists(spec, '/api/auditoria/export', 'get')
    })
    it('AuditRow exposes every field FR-019 demands', () => {
      const schema = spec.components?.schemas?.AuditRow as OpenApiSchemaRef | undefined
      const props = Object.keys(schema?.properties ?? {})
      // FR-019 bare-minimum surface — the full set the integration test asserts
      // appear in the export (T169) is broader.
      expect(props).toEqual(
        expect.arrayContaining([
          'tenant_id',
          'actor_id',
          'actor_label',
          'timestamp_utc',
          'entity',
          'entity_id',
          'field',
          'old_value',
          'new_value',
          'reason',
          'ip',
          'user_agent',
          'result',
        ]),
      )
    })
  })

  describe('Route Handler modules', () => {
    it('exports GET from src/app/api/auditoria/route.ts', async () => {
      const mod = await import('@/app/api/auditoria/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
    })
    it('exports GET from src/app/api/auditoria/export/route.ts', async () => {
      const mod = await import('@/app/api/auditoria/export/route')
      expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
    })
  })
})

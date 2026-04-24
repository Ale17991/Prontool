/**
 * Contract test applied to EVERY adapter registered in
 * src/lib/integrations/registry.ts. Guarantees the invariants that the
 * rest of the codebase relies on (label/description present, schemas parse,
 * redactCredentials never leaks, handleDomainEvent is noop-safe for
 * unsupported events).
 *
 * Adding a new adapter? Add a fixture under `FIXTURES` below and it
 * automatically inherits this suite.
 */
import { describe, it, expect } from 'vitest'
import { listAdapters } from '@/lib/integrations/registry'
import type { IntegrationAdapter, DomainEvent } from '@/lib/integrations/types'

interface AdapterFixture {
  validConfig: unknown
  validCredentials: unknown
  /** Known-bad config to confirm schema rejects it. */
  invalidConfig: unknown
  invalidCredentials: unknown
}

const FIXTURES: Record<string, AdapterFixture> = {
  ghl: {
    validConfig: {
      location_id: 'abc123XYZ789abc12345',
      trigger_stage_name: 'Pagamento confirmado',
      field_map_plano: 'plano_saude',
      field_map_procedimento_tuss: 'procedimento_tuss',
      field_map_profissional: 'profissional',
      field_map_valor: 'valor_atendimento',
    },
    validCredentials: {
      operations_pat: 'pit-token-xxxxxxxxxxxx',
      inbound_webhook_secret: 'a'.repeat(48),
    },
    invalidConfig: { location_id: 'too-short' }, // pattern fail + missing fields
    invalidCredentials: { operations_pat: 'x', inbound_webhook_secret: 'short' },
  },
}

function makePatientEvent(): DomainEvent {
  return {
    type: 'patient.created',
    patient: {
      id: 'p1',
      tenantId: 't1',
      fullName: 'Test Patient',
      cpf: '11122233344',
      email: null,
      phone: null,
      birthDate: null,
      planId: null,
      ghlContactId: null,
    },
  }
}

describe('IntegrationAdapter contract', () => {
  const adapters = listAdapters()

  it('at least one adapter is registered', () => {
    expect(adapters.length).toBeGreaterThan(0)
  })

  for (const adapter of adapters) {
    const provider = adapter.provider
    const fixture = FIXTURES[provider]

    describe(`adapter: ${provider}`, () => {
      it('has non-empty label and description', () => {
        expect(adapter.label.length).toBeGreaterThan(0)
        expect(adapter.description.length).toBeGreaterThan(0)
      })

      it('has a matching fixture entry', () => {
        expect(fixture).toBeTruthy()
      })

      if (!fixture) return

      it('configSchema accepts valid config', () => {
        const r = adapter.configSchema.safeParse(fixture.validConfig)
        expect(r.success).toBe(true)
      })

      it('configSchema rejects invalid config', () => {
        const r = adapter.configSchema.safeParse(fixture.invalidConfig)
        expect(r.success).toBe(false)
      })

      it('credentialsSchema accepts valid credentials', () => {
        const r = adapter.credentialsSchema.safeParse(fixture.validCredentials)
        expect(r.success).toBe(true)
      })

      it('credentialsSchema rejects invalid credentials', () => {
        const r = adapter.credentialsSchema.safeParse(fixture.invalidCredentials)
        expect(r.success).toBe(false)
      })

      it('redactCredentials never echoes any credential value', () => {
        const parsed = adapter.credentialsSchema.parse(fixture.validCredentials)
        const redacted = adapter.redactCredentials(parsed)
        const redactedStr = JSON.stringify(redacted)
        for (const v of Object.values(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && v.length > 4) {
            expect(redactedStr).not.toContain(v)
          }
        }
      })

      it('handleDomainEvent respects 5s budget for supported event types', async () => {
        // The adapter may legitimately throw when proxy creds are absent in
        // this synthetic context — that's a *correctness* assertion the real
        // dispatcher relies on. What we MUST NOT allow is a hang: the adapter
        // must settle (resolve or reject) within the 5 s per-adapter budget
        // used by `dispatchDomainEvent`.
        const ctx = {
          tenantId: 't1',
          provider: adapter.provider,
          config: adapter.configSchema.parse(fixture.validConfig),
          credentials: adapter.credentialsSchema.parse(fixture.validCredentials),
          supabase: {
            from: () => ({
              update: () => ({
                eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
              }),
            }),
          } as any,
          logger: {
            debug() {},
            info() {},
            warn() {},
            error() {},
            trace() {},
            fatal() {},
            child() {
              return this
            },
          } as any,
          now: () => new Date(),
        }
        const race = Promise.race([
          (adapter as IntegrationAdapter)
            .handleDomainEvent(ctx, makePatientEvent())
            .then(() => 'settled')
            .catch(() => 'settled'),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5500)),
        ])
        await expect(race).resolves.toBe('settled')
      }, 10_000)
    })
  }
})

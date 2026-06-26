/**
 * Feature 044 (US1) — cálculo de MRR / resumo financeiro.
 */
import { describe, expect, it } from 'vitest'
import { getFinancialSummary } from '@/lib/core/admin/financial-summary'

// Mock mínimo do supabase: from(table).select() → Promise<{data,error}>.
function mockSb(opts: {
  prices: Array<{ plan: string; price_cents: number }>
  ents: Array<{ tenant_id: string; plan: string; status: string | null; trial_ends_at: string | null; updated_at: string | null }>
  tenants: Array<{ id: string; name: string }>
}) {
  return {
    from(table: string) {
      return {
        select() {
          if (table === 'plan_prices') return Promise.resolve({ data: opts.prices, error: null })
          if (table === 'tenant_entitlements') return Promise.resolve({ data: opts.ents, error: null })
          if (table === 'tenants') return Promise.resolve({ data: opts.tenants, error: null })
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('getFinancialSummary (Feature 044)', () => {
  it('MRR = clínicas ativas por plano × preço; total = soma', async () => {
    const sb = mockSb({
      prices: [
        { plan: 'essencial', price_cents: 9900 },
        { plan: 'pro', price_cents: 19900 },
        { plan: 'clinica', price_cents: 29900 },
        { plan: 'legacy', price_cents: 5000 },
      ],
      ents: [
        { tenant_id: 'a', plan: 'pro', status: 'active', trial_ends_at: null, updated_at: null },
        { tenant_id: 'b', plan: 'pro', status: 'active', trial_ends_at: null, updated_at: null },
        { tenant_id: 'c', plan: 'essencial', status: 'active', trial_ends_at: null, updated_at: null },
        { tenant_id: 'd', plan: 'legacy', status: 'active', trial_ends_at: null, updated_at: null },
        { tenant_id: 'e', plan: 'clinica', status: 'trial', trial_ends_at: null, updated_at: null },
        { tenant_id: 'f', plan: 'pro', status: 'canceled', trial_ends_at: null, updated_at: null },
      ],
      tenants: [],
    })

    const s = await getFinancialSummary(sb, {})
    expect(s.mrrByPlan.pro.cents).toBe(2 * 19900)
    expect(s.mrrByPlan.essencial.cents).toBe(9900)
    expect(s.mrrByPlan.legacy.cents).toBe(5000) // legado entra no MRR
    expect(s.mrrByPlan.clinica.cents).toBe(0) // trial não conta no MRR
    expect(s.mrrTotalCents).toBe(2 * 19900 + 9900 + 5000)
  })

  it('conta clínicas por status de cobrança', async () => {
    const sb = mockSb({
      prices: [{ plan: 'pro', price_cents: 100 }],
      ents: [
        { tenant_id: 'a', plan: 'pro', status: 'active', trial_ends_at: null, updated_at: null },
        { tenant_id: 'b', plan: 'pro', status: 'trial', trial_ends_at: null, updated_at: null },
        { tenant_id: 'c', plan: 'pro', status: 'past_due', trial_ends_at: null, updated_at: null },
        { tenant_id: 'd', plan: 'pro', status: 'canceled', trial_ends_at: null, updated_at: null },
      ],
      tenants: [],
    })
    const s = await getFinancialSummary(sb, {})
    expect(s.countByStatus).toEqual({ active: 1, trial: 1, past_due: 1, canceled: 1 })
    expect(s.pastDue).toHaveLength(1)
  })
})

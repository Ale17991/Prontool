/**
 * T136 — Monthly report over a period without atendimentos must return
 * zeros (empty arrays + totals of 0), not an error. Also validates the
 * HTTP endpoint returns 200 with the same shape.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { buildMonthlyReport } from '@/lib/core/reports/monthly'

describe('T136 — empty monthly report', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns zeros for a tenant-month with no appointments', async () => {
    const { tenantId } = await seedTenant('t136')
    const sb = serviceClient()

    const report = await buildMonthlyReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    expect(report.revenueByPlan).toEqual([])
    expect(report.productionByDoctor).toEqual([])
    expect(report.totals).toEqual({
      netRevenueCents: 0,
      netCommissionCents: 0,
      appointmentCount: 0,
      reversalCount: 0,
    })
  })

  it('HTTP endpoint responds 200 with zero totals', async () => {
    const { tenantId } = await seedTenant('t136-http')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })

    const { GET } = await import('@/app/api/relatorios/mensal/route')
    const res = await GET(
      new Request(
        'http://localhost/api/relatorios/mensal?from=2026-05-01&to=2026-05-31',
        { method: 'GET', headers: { authorization: `Bearer ${jwt}` } },
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      revenue_by_plan: unknown[]
      production_by_doctor: unknown[]
      totals: {
        net_revenue_cents: number
        net_commission_cents: number
        appointment_count: number
        reversal_count: number
      }
    }
    expect(body.revenue_by_plan).toEqual([])
    expect(body.production_by_doctor).toEqual([])
    expect(body.totals).toEqual({
      net_revenue_cents: 0,
      net_commission_cents: 0,
      appointment_count: 0,
      reversal_count: 0,
    })
  })
})

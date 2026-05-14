/**
 * T013 (Feature 013) — RBAC em POST/PATCH /api/medicos com modalidade.
 *
 * - POST /api/medicos é admin-only (sem mudança vs feature anterior).
 * - PATCH /api/medicos/[id] com `payment_mode_change` é admin-only;
 *   demais campos (full_name, active) continuam admin via requireRole atual.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — RBAC /api/medicos payment_mode', () => {
  let tenantId: string
  let adminJwt: string
  let recepcionistaJwt: string
  let doctorId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('rbac-pm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const rec = await seedUser(tenantId, 'recepcionista', 'rec')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    recepcionistaJwt = mintJwt({
      userId: rec.userId,
      email: rec.email,
      tenantId,
      role: 'recepcionista',
    })
    const { doctorId: d } = await seedDoctor(tenantId)
    doctorId = d
  })

  it('Recepcionista NÃO pode mudar modalidade (PATCH retorna 403)', async () => {
    const { PATCH } = await import('@/app/api/medicos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${recepcionistaJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payment_mode_change: {
            payment_mode: 'fixo',
            monthly_amount_cents: 800000,
            billing_day: 5,
            valid_from: new Date().toISOString().slice(0, 10),
            reason: 'tentativa não-admin',
          },
        }),
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(403)
  })

  it('Admin pode mudar modalidade para Fixo (PATCH retorna 200)', async () => {
    const { PATCH } = await import('@/app/api/medicos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payment_mode_change: {
            payment_mode: 'fixo',
            monthly_amount_cents: 800000,
            billing_day: 5,
            valid_from: new Date().toISOString().slice(0, 10),
            reason: 'Mudança para CLT',
          },
        }),
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { payment_mode: string }
    expect(body.payment_mode).toBe('fixo')
  })

  it('Recepcionista pode chamar GET (read) — leitura permitida', async () => {
    const { GET } = await import('@/app/api/medicos/[id]/route')
    const res = await GET(
      new Request(`http://localhost/api/medicos/${doctorId}`, {
        headers: { authorization: `Bearer ${recepcionistaJwt}` },
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { payment_mode: string }
    expect(body.payment_mode).toBe('fixo')
  })
})

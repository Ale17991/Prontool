/**
 * T014 (Feature 013) — criação de profissional nas 3 modalidades.
 *
 * Cada modalidade persiste:
 *   - doctors com payment_mode correto
 *   - doctor_commission_history (1 row, bps real ou 0)
 *   - doctor_payment_terms_history (1 row com params da modalidade)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — POST /api/medicos com 3 modalidades', () => {
  let tenantId: string
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('cr-pm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
  })

  it('Cria profissional Comissionado e popula commission_history + payment_terms_history', async () => {
    const { POST } = await import('@/app/api/medicos/route')
    const res = await POST(
      new Request('http://localhost/api/medicos', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          full_name: 'Dr. Comissionado',
          crm: 'CRM-001',
          payment_mode: 'comissionado',
          initial_percentage_bps: 3000,
          initial_valid_from: '2024-01-01',
          initial_reason: 'Cadastro inicial',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; payment_mode: string }
    expect(body.payment_mode).toBe('comissionado')

    const sb = serviceClient()
    const { data: pt } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('payment_mode, percentage_bps, monthly_amount_cents, liberal_default_cents')
      .eq('doctor_id', body.id)
      .single()
    const row = pt as unknown as {
      payment_mode: string
      percentage_bps: number | null
      monthly_amount_cents: number | null
      liberal_default_cents: number | null
    }
    expect(row.payment_mode).toBe('comissionado')
    expect(row.percentage_bps).toBe(3000)
    expect(row.monthly_amount_cents).toBeNull()
    expect(row.liberal_default_cents).toBeNull()
  })

  it('Cria profissional Fixo com valor mensal + dia de faturamento', async () => {
    const { POST } = await import('@/app/api/medicos/route')
    const res = await POST(
      new Request('http://localhost/api/medicos', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          full_name: 'Dr. Fixo',
          crm: 'CRM-002',
          payment_mode: 'fixo',
          monthly_amount_cents: 800000,
          billing_day: 5,
          initial_valid_from: '2024-01-01',
          initial_reason: 'CLT',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; payment_mode: string }
    expect(body.payment_mode).toBe('fixo')

    const sb = serviceClient()
    const { data: pt } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('payment_mode, monthly_amount_cents, billing_day, percentage_bps')
      .eq('doctor_id', body.id)
      .single()
    const row = pt as unknown as {
      payment_mode: string
      monthly_amount_cents: number
      billing_day: number
      percentage_bps: number | null
    }
    expect(row.payment_mode).toBe('fixo')
    expect(row.monthly_amount_cents).toBe(800000)
    expect(row.billing_day).toBe(5)
    expect(row.percentage_bps).toBeNull()

    // commission_history existe com bps=0 (preserva fluxo de appointment lookup)
    const { data: comm } = await sb
      .from('doctor_commission_history')
      .select('percentage_bps')
      .eq('doctor_id', body.id)
      .single()
    expect((comm as unknown as { percentage_bps: number }).percentage_bps).toBe(0)
  })

  it('Cria profissional Liberal com valor padrão por participação', async () => {
    const { POST } = await import('@/app/api/medicos/route')
    const res = await POST(
      new Request('http://localhost/api/medicos', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          full_name: 'Dr. Liberal',
          crm: 'CRM-003',
          payment_mode: 'liberal',
          liberal_default_cents: 35000,
          initial_valid_from: '2024-01-01',
          initial_reason: 'Anestesista parceiro',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; payment_mode: string }
    expect(body.payment_mode).toBe('liberal')

    const sb = serviceClient()
    const { data: pt } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('payment_mode, liberal_default_cents, monthly_amount_cents, percentage_bps')
      .eq('doctor_id', body.id)
      .single()
    const row = pt as unknown as {
      payment_mode: string
      liberal_default_cents: number
      monthly_amount_cents: number | null
      percentage_bps: number | null
    }
    expect(row.payment_mode).toBe('liberal')
    expect(row.liberal_default_cents).toBe(35000)
    expect(row.monthly_amount_cents).toBeNull()
    expect(row.percentage_bps).toBeNull()
  })

  it('Default backward-compat: cliente sem payment_mode cai em comissionado', async () => {
    const { POST } = await import('@/app/api/medicos/route')
    const res = await POST(
      new Request('http://localhost/api/medicos', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          full_name: 'Dra. Legacy',
          crm: 'CRM-004',
          initial_percentage_bps: 4000,
          initial_valid_from: '2024-01-01',
          initial_reason: 'cliente antigo sem payment_mode',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { payment_mode: string }
    expect(body.payment_mode).toBe('comissionado')
  })
})

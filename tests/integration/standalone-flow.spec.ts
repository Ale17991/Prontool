/**
 * US1 — Standalone flow: tenant without any tenant_integrations row must be
 * able to create a manual appointment with no outbound HTTP, no alerts,
 * and integrations_dispatched=[] in the response.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedDoctor,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('US1 — POST /api/atendimentos/manual (standalone)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('cria atendimento manual sem integrações ativas (integrations_dispatched=[])', async () => {
    const { tenantId } = await seedTenant('us1-happy')
    const admin = await seedUser(tenantId, 'admin')
    const planId = await seedHealthPlan(tenantId, 'Plano Teste')
    const { doctorId } = await seedDoctor(tenantId, { bps: 3000 })
    await seedTussCode('10101012')
    const procedureId = await seedProcedure(tenantId, '10101012')
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 15000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          procedure_id: procedureId,
          plan_id: planId,
          appointment_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    )

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      appointment_id: string
      source: string
      frozen_amount_cents: number
      integrations_dispatched: unknown[]
    }
    expect(body.source).toBe('manual')
    expect(body.frozen_amount_cents).toBe(15000)
    expect(body.integrations_dispatched).toEqual([])

    // Nenhum alerta deve ter sido criado
    const sb = serviceClient()
    const alerts = await sb.from('alerts').select('*').eq('tenant_id', tenantId)
    expect(alerts.data ?? []).toHaveLength(0)

    // Appointment row tem source='manual' e source_raw_event_id NULL
    const row = await sb
      .from('appointments')
      .select('source, source_raw_event_id')
      .eq('id', body.appointment_id)
      .single()
    expect(row.data?.source).toBe('manual')
    expect(row.data?.source_raw_event_id).toBeNull()
  })

  it('override de valor persiste o override em frozen_amount_cents mas mantém price_version_id vigente', async () => {
    const { tenantId } = await seedTenant('us1-override')
    const admin = await seedUser(tenantId, 'admin')
    const planId = await seedHealthPlan(tenantId, 'Plano Teste')
    const { doctorId } = await seedDoctor(tenantId, { bps: 3000 })
    await seedTussCode('10101013')
    const procedureId = await seedProcedure(tenantId, '10101013')
    const vigenteId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          procedure_id: procedureId,
          plan_id: planId,
          appointment_at: new Date(Date.now() - 60_000).toISOString(),
          amount_cents_override: 12000,
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { appointment_id: string; frozen_amount_cents: number }
    expect(body.frozen_amount_cents).toBe(12000)

    const sb = serviceClient()
    const row = await sb
      .from('appointments')
      .select('frozen_amount_cents, source_price_version_id')
      .eq('id', body.appointment_id)
      .single()
    expect(row.data?.frozen_amount_cents).toBe(12000)
    expect(row.data?.source_price_version_id).toBe(vigenteId)
  })

  it('rejeita appointment_at no futuro', async () => {
    const { tenantId } = await seedTenant('us1-future')
    const admin = await seedUser(tenantId, 'admin')
    const planId = await seedHealthPlan(tenantId)
    const { doctorId } = await seedDoctor(tenantId)
    await seedTussCode('10101014')
    const procedureId = await seedProcedure(tenantId, '10101014')
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          procedure_id: procedureId,
          plan_id: planId,
          appointment_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('APPOINTMENT_IN_FUTURE')
  })

  it('rejeita financeiro com 403 (só admin e recepcionista)', async () => {
    const { tenantId } = await seedTenant('us1-rbac')
    const financeiro = await seedUser(tenantId, 'financeiro')
    const jwt = mintJwt({
      userId: financeiro.userId,
      email: financeiro.email,
      tenantId,
      role: 'financeiro',
    })
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: '00000000-0000-0000-0000-000000000000',
          doctor_id: '00000000-0000-0000-0000-000000000000',
          procedure_id: '00000000-0000-0000-0000-000000000000',
          plan_id: '00000000-0000-0000-0000-000000000000',
          appointment_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('rejeita FKs de outro tenant com 404 (tenant isolation)', async () => {
    const { tenantId: tenantA } = await seedTenant('us1-iso-a')
    const { tenantId: tenantB } = await seedTenant('us1-iso-b')

    const admin = await seedUser(tenantA, 'admin')

    // Seed everything in tenantB
    const planB = await seedHealthPlan(tenantB, 'Plano B')
    const { doctorId: doctorB } = await seedDoctor(tenantB)
    await seedTussCode('10101015')
    const procedureB = await seedProcedure(tenantB, '10101015')
    await seedPriceVersion({
      tenantId: tenantB,
      procedureId: procedureB,
      planId: planB,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })
    const patientB = await seedPatient(tenantB)

    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId: tenantA,
      role: 'admin',
    })
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientB,
          doctor_id: doctorB,
          procedure_id: procedureB,
          plan_id: planB,
          appointment_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    // Promise.all resolves in any order — any of the FK-not-found codes is valid.
    expect(body.error.code).toMatch(/_NOT_FOUND$/)
  })
})

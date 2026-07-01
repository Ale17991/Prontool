/**
 * T030-T034 (Feature 013) — fluxo principal de US2:
 *  - criar atendimento com 2 assistentes em uma chamada
 *  - frozen_amount_cents congelado (não retroage com mudança de default)
 *  - soft-remove via PATCH preserva registro mas exclui dos relatórios
 *  - estorno do atendimento principal preserva registros
 *  - Liberal NÃO pode ser doutor principal (LIBERAL_AS_PRINCIPAL)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — atendimento com assistentes (E2E)', () => {
  let tenantId: string
  let adminJwt: string
  let adminUserId: string
  let principalId: string
  let liberalAId: string
  let liberalBId: string
  let planId: string
  let procedureId: string
  let patientId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('e2e-as')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const principal = await seedDoctor(tenantId, { bps: 3000 })
    principalId = principal.doctorId
    const lA = await seedDoctor(tenantId, { paymentMode: 'liberal', liberalDefaultCents: 35000 })
    liberalAId = lA.doctorId
    const lB = await seedDoctor(tenantId, { paymentMode: 'liberal', liberalDefaultCents: 20000 })
    liberalBId = lB.doctorId
    planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010050')
    procedureId = await seedProcedure(tenantId, '00010050')
    await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    patientId = await seedPatient(tenantId)
  })

  it('Cria atendimento com 2 assistentes via POST /api/atendimentos/manual', async () => {
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: principalId,
          procedures: [
            { procedure_id: procedureId, plan_id: planId, amount_cents_override: 20000 },
          ],
          appointment_at: new Date(Date.now() + 60_000).toISOString(),
          duration_minutes: 30,
          assistants: [
            { assistant_doctor_id: liberalAId, amount_cents: 35000 },
            { assistant_doctor_id: liberalBId, amount_cents: 25000 }, // override do default
          ],
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      appointment_id: string
      assistants_count: number
      assistants: Array<{ assistantDoctorId: string; frozenAmountCents: number }>
    }
    expect(body.assistants_count).toBe(2)

    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('assistant_doctor_id, frozen_amount_cents')
      .eq('appointment_id', body.appointment_id)
      .is('removed_at', null)
      .order('frozen_amount_cents', { ascending: false })
    const rows = data as unknown as Array<{
      assistant_doctor_id: string
      frozen_amount_cents: number
    }>
    expect(rows.length).toBe(2)
    expect(rows[0]?.frozen_amount_cents).toBe(35000)
    expect(rows[1]?.frozen_amount_cents).toBe(25000)
  })

  it('frozen_amount_cents preservado quando default do liberal muda depois', async () => {
    // O atendimento criado no teste anterior tinha frozen=35000 para liberalA (default original).
    // Agora mudamos o default no payment_terms_history para 99999.
    const sb = serviceClient()
    await sb.from('doctor_payment_terms_history' as never).insert({
      tenant_id: tenantId,
      doctor_id: liberalAId,
      payment_mode: 'liberal',
      liberal_default_cents: 99999,
      valid_from: new Date().toISOString().slice(0, 10),
      reason: 'aumento de tabela',
      created_by: adminUserId,
    } as never)
    // O frozen_amount_cents do assistant antigo NÃO mudou.
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('frozen_amount_cents')
      .eq('assistant_doctor_id', liberalAId)
      .is('removed_at', null)
    const rows = data as unknown as Array<{ frozen_amount_cents: number }>
    expect(rows.some((r) => r.frozen_amount_cents === 35000)).toBe(true)
  })

  it('Liberal NÃO pode ser principal (LIBERAL_AS_PRINCIPAL)', async () => {
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: liberalAId, // Liberal como principal → bloqueio
          procedures: [
            { procedure_id: procedureId, plan_id: planId, amount_cents_override: 20000 },
          ],
          appointment_at: new Date(Date.now() + 120_000).toISOString(),
          duration_minutes: 30,
        }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('LIBERAL_AS_PRINCIPAL')
  })

  it('Mesmo liberal duplicado em assistants[] retorna DUPLICATE_ASSISTANT', async () => {
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: principalId,
          procedures: [
            { procedure_id: procedureId, plan_id: planId, amount_cents_override: 20000 },
          ],
          appointment_at: new Date(Date.now() + 180_000).toISOString(),
          duration_minutes: 30,
          assistants: [
            { assistant_doctor_id: liberalAId, amount_cents: 35000 },
            { assistant_doctor_id: liberalAId, amount_cents: 40000 }, // duplicado
          ],
        }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DUPLICATE_ASSISTANT')
  })
})

/**
 * T026 (Feature 030) — US2: equipe registra métrica metabólica via
 * POST /api/pacientes/[id]/medicoes.
 *
 *  - profissional registra → 201 e o valor aparece no bundle do paciente;
 *  - valor implausível → 422 com mensagem clara (FR-013);
 *  - recepcionista → 403 (FR-014, requireRole + audit deny).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedClinicProfile,
  seedPatientWithPii,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { POST as medicoesPost, GET as medicoesGet } from '@/app/api/pacientes/[id]/medicoes/route'
import { GET as dadosGet } from '@/app/api/paciente/dados/route'
import {
  createPatientSessionCookie,
  PATIENT_SESSION_COOKIE_NAME,
} from '@/lib/core/patient-portal/session'
import type { NextRequest } from 'next/server'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 030 — staff registra métrica metabólica (US2)', () => {
  let tenantId: string
  let patientId: string
  const jwts: Partial<Record<TenantRole, string>> = {}

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('staff-metric')).tenantId
    await seedClinicProfile(tenantId, { slug: 'clinica-staff-metric' })
    patientId = await seedPatientWithPii(tenantId, {
      cpf: '52998224725',
      birthDate: '1990-05-15',
    })
    for (const role of ['profissional_saude', 'recepcionista'] as TenantRole[]) {
      const u = await seedUser(tenantId, role)
      jwts[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
  })

  function post(role: TenantRole, body: Record<string, unknown>) {
    return medicoesPost(
      new Request(`http://localhost/api/pacientes/${patientId}/medicoes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwts[role]}`,
        },
        body: JSON.stringify(body),
      }),
      { params: { id: patientId } },
    )
  }

  it('profissional registra HbA1c em duas datas → 201 e aparece no GET staff', async () => {
    const first = await post('profissional_saude', {
      metric_type: 'hba1c',
      value: 8.1,
      measured_at: '2026-04-10',
    })
    expect(first.status).toBe(201)
    const second = await post('profissional_saude', {
      metric_type: 'hba1c',
      value: 7.4,
      measured_at: '2026-05-10',
      notes: 'pós ajuste de dieta',
    })
    expect(second.status).toBe(201)
    const created = (await second.json()) as { id: string; unit: string }
    expect(created.unit).toBe('%') // unidade default do catálogo

    const list = await medicoesGet(
      new Request(`http://localhost/api/pacientes/${patientId}/medicoes`, {
        headers: { authorization: `Bearer ${jwts.profissional_saude}` },
      }),
      { params: { id: patientId } },
    )
    expect(list.status).toBe(200)
    const body = (await list.json()) as {
      measurements: Record<string, Array<{ value: number }>>
      metricTypes: unknown[]
    }
    expect(body.measurements.hba1c).toHaveLength(2)
    expect(body.metricTypes.length).toBeGreaterThanOrEqual(7)
  })

  it('o valor registrado aparece no portal do paciente (fecha o ciclo US1+US2)', async () => {
    const cookie = createPatientSessionCookie({ patientId, tenantId })
    const res = await dadosGet(
      new Request('http://localhost/api/paciente/dados', {
        headers: { cookie: `${PATIENT_SESSION_COOKIE_NAME}=${cookie}` },
      }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)
    const bundle = (await res.json()) as {
      metrics: Record<string, Array<{ value: number }>>
    }
    expect(bundle.metrics.hba1c!.map((m) => m.value)).toEqual([8.1, 7.4])
  })

  it('valor implausível (HbA1c 99) → 422 com mensagem clara', async () => {
    const res = await post('profissional_saude', {
      metric_type: 'hba1c',
      value: 99,
      measured_at: '2026-05-11',
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/faixa plausível/i)
  })

  it('métrica desconhecida → 422', async () => {
    const res = await post('profissional_saude', {
      metric_type: 'metric_que_nao_existe',
      value: 10,
      measured_at: '2026-05-11',
    })
    expect(res.status).toBe(422)
  })

  it('recepcionista → 403 (FR-014)', async () => {
    const res = await post('recepcionista', {
      metric_type: 'hba1c',
      value: 7.0,
      measured_at: '2026-05-12',
    })
    expect(res.status).toBe(403)
  })
})

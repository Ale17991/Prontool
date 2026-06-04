/**
 * T016 (Feature 030) — isolamento do portal (FR-003, SC-002).
 *
 * Invariante 1 do contrato patient-session.md: a sessão de um paciente
 * NUNCA lê dados de outro paciente nem de outra clínica. O endpoint
 * /api/paciente/dados deriva identidade SÓ do cookie HMAC — cookie
 * adulterado (payload trocado) é rejeitado pela assinatura.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedClinicProfile,
  seedPatientWithPii,
} from '@/tests/helpers/seed-factories'
import {
  createPatientSessionCookie,
  verifyPatientSessionCookie,
  PATIENT_SESSION_COOKIE_NAME,
} from '@/lib/core/patient-portal/session'
import { GET as dadosGet } from '@/app/api/paciente/dados/route'
import type { NextRequest } from 'next/server'

function dadosRequest(cookieValue: string | null): NextRequest {
  const headers: Record<string, string> = { 'x-forwarded-for': '10.1.0.1' }
  if (cookieValue !== null) {
    headers.cookie = `${PATIENT_SESSION_COOKIE_NAME}=${cookieValue}`
  }
  return new Request('http://localhost/api/paciente/dados', {
    headers,
  }) as unknown as NextRequest
}

describe('Feature 030 — isolamento do portal do paciente', () => {
  let tenantA: string
  let tenantB: string
  let patientA: string
  let patientB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('portal-iso-a')).tenantId
    tenantB = (await seedTenant('portal-iso-b')).tenantId
    await seedClinicProfile(tenantA, { slug: 'clinica-iso-a' })
    await seedClinicProfile(tenantB, { slug: 'clinica-iso-b' })
    patientA = await seedPatientWithPii(tenantA, {
      cpf: '52998224725',
      birthDate: '1990-05-15',
      fullName: 'Alice Portal',
    })
    patientB = await seedPatientWithPii(tenantB, {
      cpf: '11144477735',
      birthDate: '1985-01-20',
      fullName: 'Bruno Portal',
    })

    // Medições distintas para A (hba1c) e B (glicemia).
    const sb = serviceClient()
    const actorA = (await seedUser(tenantA, 'profissional_saude')).userId
    const actorB = (await seedUser(tenantB, 'profissional_saude')).userId
    await sb
      .from('patient_measurements')
      .insert([
        {
          tenant_id: tenantA,
          patient_id: patientA,
          metric_type: 'hba1c',
          value: 7.1,
          unit: '%',
          measured_at: '2026-05-01',
          created_by_user_id: actorA,
        },
        {
          tenant_id: tenantB,
          patient_id: patientB,
          metric_type: 'glicemia_jejum',
          value: 130,
          unit: 'mg/dL',
          measured_at: '2026-05-01',
          created_by_user_id: actorB,
        },
      ])
      .throwOnError()
  })

  it('sessão do paciente A retorna SÓ os dados de A', async () => {
    const cookie = createPatientSessionCookie({ patientId: patientA, tenantId: tenantA })
    const res = await dadosGet(dadosRequest(cookie))
    expect(res.status).toBe(200)
    const bundle = (await res.json()) as {
      patient: { firstName: string }
      metrics: Record<string, unknown[]>
    }
    expect(bundle.patient.firstName).toBe('Alice')
    expect(bundle.metrics.hba1c).toHaveLength(1)
    // Nada do paciente B (outra clínica/métrica) vaza:
    expect(bundle.metrics.glicemia_jejum ?? []).toHaveLength(0)
  })

  it('cookie adulterado (payload trocado p/ paciente B) é rejeitado', async () => {
    const valid = createPatientSessionCookie({ patientId: patientA, tenantId: tenantA })
    const sig = valid.slice(valid.lastIndexOf('.') + 1)
    const forgedPayload = Buffer.from(
      JSON.stringify({
        patientId: patientB,
        tenantId: tenantB,
        iatMs: Date.now(),
        expMs: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url')
    const forged = `${forgedPayload}.${sig}`
    expect(verifyPatientSessionCookie(forged)).toBeNull()

    const res = await dadosGet(dadosRequest(forged))
    expect(res.status).toBe(401)
  })

  it('sem cookie → 401; cookie expirado → 401', async () => {
    const noCookie = await dadosGet(dadosRequest(null))
    expect(noCookie.status).toBe(401)

    const expired = createPatientSessionCookie({
      patientId: patientA,
      tenantId: tenantA,
      nowMs: Date.now() - 31 * 60 * 1000, // emitido há 31min (TTL=30min)
    })
    const res = await dadosGet(dadosRequest(expired))
    expect(res.status).toBe(401)
  })

  it('endpoint ignora patient_id/tenant_id vindos do cliente (query string)', async () => {
    const cookie = createPatientSessionCookie({ patientId: patientA, tenantId: tenantA })
    const req = new Request(
      `http://localhost/api/paciente/dados?patient_id=${patientB}&tenant_id=${tenantB}`,
      { headers: { cookie: `${PATIENT_SESSION_COOKIE_NAME}=${cookie}` } },
    ) as unknown as NextRequest
    const res = await dadosGet(req)
    expect(res.status).toBe(200)
    const bundle = (await res.json()) as { patient: { firstName: string } }
    expect(bundle.patient.firstName).toBe('Alice') // continua A — params ignorados
  })

  it('sessão do paciente NÃO concede acesso a endpoint de staff (invariante 4)', async () => {
    const cookie = createPatientSessionCookie({ patientId: patientA, tenantId: tenantA })
    const { GET } = await import('@/app/api/pacientes/[id]/medicoes/route')
    const res = await GET(
      new Request(`http://localhost/api/pacientes/${patientA}/medicoes`, {
        headers: { cookie: `${PATIENT_SESSION_COOKIE_NAME}=${cookie}` },
      }),
      { params: { id: patientA } },
    )
    expect(res.status).toBe(401) // requireRole não reconhece a sessão do paciente
  })
})

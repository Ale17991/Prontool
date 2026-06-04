/**
 * T017 (Feature 030) — fluxo US1: login OK → GET /api/paciente/dados traz a
 * evolução de peso/IMC (vital_signs) + métricas metabólicas do próprio
 * paciente (FR-006/FR-007/FR-008), com estados vazios consistentes.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedClinicProfile,
  seedPatientWithPii,
} from '@/tests/helpers/seed-factories'
import { POST as loginPost } from '@/app/api/paciente/login/route'
import { GET as dadosGet } from '@/app/api/paciente/dados/route'
import type { NextRequest } from 'next/server'

const SLUG = 'clinica-portal-read'
const CPF = '52998224725'

describe('Feature 030 — login → leitura do portal (US1)', () => {
  let tenantId: string
  let patientId: string
  let cookieHeader: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('portal-read')).tenantId
    await seedClinicProfile(tenantId, { slug: SLUG })
    patientId = await seedPatientWithPii(tenantId, {
      cpf: CPF,
      birthDate: '1990-05-15',
      fullName: 'Carla Evolução',
    })
    const actor = (await seedUser(tenantId, 'profissional_saude')).userId

    const sb = serviceClient()
    // Evolução de peso (2 pontos) — reuso de vital_signs (FR-007).
    await sb
      .from('vital_signs')
      .insert([
        {
          tenant_id: tenantId,
          patient_id: patientId,
          measured_at: '2026-04-01T10:00:00Z',
          weight_grams: 82_000,
          height_cm: 165,
          measured_by: actor,
        },
        {
          tenant_id: tenantId,
          patient_id: patientId,
          measured_at: '2026-05-01T10:00:00Z',
          weight_grams: 80_500,
          height_cm: 165,
          measured_by: actor,
        },
      ])
      .throwOnError()
    // Métrica metabólica em duas datas (FR-008).
    await sb
      .from('patient_measurements')
      .insert([
        {
          tenant_id: tenantId,
          patient_id: patientId,
          metric_type: 'hba1c',
          value: 8.2,
          unit: '%',
          measured_at: '2026-04-01',
          created_by_user_id: actor,
        },
        {
          tenant_id: tenantId,
          patient_id: patientId,
          metric_type: 'hba1c',
          value: 7.6,
          unit: '%',
          measured_at: '2026-05-01',
          created_by_user_id: actor,
        },
      ])
      .throwOnError()

    // Login real pela rota.
    const loginRes = await loginPost(
      new Request('http://localhost/api/paciente/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.2.0.1' },
        body: JSON.stringify({
          slug: SLUG,
          cpf: CPF,
          birthdate: '15051990',
          lgpd_consent: true,
        }),
      }) as unknown as NextRequest,
    )
    expect(loginRes.status).toBe(200)
    const setCookie = loginRes.headers.get('set-cookie') ?? ''
    const value = /clinni-patient-session=([^;]+)/.exec(setCookie)?.[1]
    expect(value).toBeTruthy()
    cookieHeader = `clinni-patient-session=${value}`
  })

  it('bundle traz nome, evolução de peso/IMC e série de HbA1c em ordem cronológica', async () => {
    const res = await dadosGet(
      new Request('http://localhost/api/paciente/dados', {
        headers: { cookie: cookieHeader, 'x-forwarded-for': '10.2.0.1' },
      }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)
    const bundle = (await res.json()) as {
      patient: { firstName: string }
      weightImc: Array<{ weightKg: number | null; bmi: number | null }>
      metrics: Record<string, Array<{ value: number; measuredAt: string }>>
      metricTypes: Array<{ metricType: string }>
    }
    expect(bundle.patient.firstName).toBe('Carla')

    expect(bundle.weightImc).toHaveLength(2)
    expect(bundle.weightImc[0]!.weightKg).toBe(82)
    expect(bundle.weightImc[1]!.weightKg).toBe(80.5)
    expect(bundle.weightImc[1]!.bmi).not.toBeNull() // IMC calculado (peso+altura)

    const hba1c = bundle.metrics.hba1c!
    expect(hba1c).toHaveLength(2)
    expect(hba1c[0]!.value).toBe(8.2)
    expect(hba1c[1]!.value).toBe(7.6)

    // Catálogo endócrino acompanha o bundle (rótulos/faixas p/ a UI).
    expect(bundle.metricTypes.map((m) => m.metricType)).toContain('glicemia_jejum')
  })

  it('a leitura gera "view" no access log (FR-020) com IP só-hash', async () => {
    const sb = serviceClient()
    const { data } = await sb
      .from('patient_portal_access_log')
      .select('action, ip_hash, patient_id')
      .eq('tenant_id', tenantId)
      .eq('action', 'view')
    expect((data ?? []).length).toBeGreaterThan(0)
    const row = (data as Array<{ ip_hash: string; patient_id: string }>)[0]!
    expect(row.patient_id).toBe(patientId)
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/) // sha-256, nunca IP em claro
  })
})

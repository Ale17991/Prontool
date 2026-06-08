/**
 * T015 (Feature 030) — contrato do login do paciente (FR-002/FR-017/FR-019).
 *
 * Invariantes (contracts/patient-session.md):
 *  2. falhas indistinguíveis: nascimento errado e CPF inexistente → mesma
 *     resposta 401 genérica;
 *  3. após N falhas → 429 (rate-limit por CPF×clínica e IP×clínica).
 * Também: paciente anonimizado não loga (FR-022) e CPF duplicado na mesma
 * clínica bloqueia o acesso (edge case do spec — ambíguo nunca expõe
 * prontuário errado).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedClinicProfile,
  seedPatientWithPii,
} from '@/tests/helpers/seed-factories'
import { POST as loginPost } from '@/app/api/paciente/login/route'
import type { NextRequest } from 'next/server'

const SLUG = 'clinica-portal-login'
const CPF = '52998224725'
const BIRTH_ISO = '1990-05-15'
const BIRTH_DIGITS = '15051990' // DDMMYYYY

function loginRequest(body: Record<string, unknown>, ip = '10.0.0.1'): NextRequest {
  return new Request('http://localhost/api/paciente/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ slug: SLUG, lgpd_consent: true, ...body }),
  }) as unknown as NextRequest
}

describe('Feature 030 — contrato do login do portal', () => {
  beforeAll(async () => {
    await resetDatabase()
    const { tenantId } = await seedTenant('portal-login')
    await seedClinicProfile(tenantId, { slug: SLUG })
    await seedPatientWithPii(tenantId, { cpf: CPF, birthDate: BIRTH_ISO })
  })

  it('CPF e nascimento corretos → 200 + Set-Cookie httpOnly', async () => {
    const res = await loginPost(loginRequest({ cpf: CPF, birthdate: BIRTH_DIGITS }, '10.0.0.9'))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('clinni-patient-session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=strict')
  })

  it('nascimento errado → 401 genérico', async () => {
    const res = await loginPost(loginRequest({ cpf: CPF, birthdate: '01011999' }, '10.0.1.1'))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('CPF ou data de nascimento inválidos.')
  })

  it('CPF inexistente → MESMA resposta 401 (não revela se o CPF existe)', async () => {
    const wrongBirth = await loginPost(
      loginRequest({ cpf: CPF, birthdate: '01011999' }, '10.0.1.2'),
    )
    const unknownCpf = await loginPost(
      loginRequest({ cpf: '11144477735', birthdate: BIRTH_DIGITS }, '10.0.1.3'),
    )
    expect(unknownCpf.status).toBe(401)
    expect(await unknownCpf.json()).toEqual(await wrongBirth.json())
  })

  it('após 5 falhas do mesmo IP → 429 com Retry-After', async () => {
    const ip = '10.0.2.50'
    // CPFs distintos por tentativa: aqui o limite estourado é o por IP
    // (o teste seguinte cobre o limite por CPF).
    const cpfs = ['99988877701', '99988877702', '99988877703', '99988877704', '99988877705']
    for (const cpf of cpfs) {
      const res = await loginPost(loginRequest({ cpf, birthdate: '01011990' }, ip))
      expect(res.status).toBe(401)
    }
    const blocked = await loginPost(
      loginRequest({ cpf: '99988877706', birthdate: '01011990' }, ip),
    )
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('após 5 falhas do mesmo CPF (IPs distintos) → 429 (rate-limit por CPF)', async () => {
    const cpf = '39053344705'
    for (let i = 0; i < 5; i++) {
      const res = await loginPost(
        loginRequest({ cpf, birthdate: '01011990' }, `10.0.3.${i + 1}`),
      )
      expect(res.status).toBe(401)
    }
    const blocked = await loginPost(loginRequest({ cpf, birthdate: '01011990' }, '10.0.3.99'))
    expect(blocked.status).toBe(429)
  })

  it('paciente anonimizado não loga (FR-022)', async () => {
    const sb = serviceClient()
    const { tenantId } = await seedTenant('portal-login-anon')
    const slug = 'clinica-portal-anon'
    await seedClinicProfile(tenantId, { slug })
    const pid = await seedPatientWithPii(tenantId, { cpf: CPF, birthDate: BIRTH_ISO })
    await sb
      .from('patients')
      .update({ anonymized_at: new Date().toISOString() })
      .eq('id', pid)
      .throwOnError()

    const res = await loginPost(
      loginRequest({ slug, cpf: CPF, birthdate: BIRTH_DIGITS }, '10.0.4.1'),
    )
    expect(res.status).toBe(401)
  })

  it('CPF duplicado na mesma clínica → acesso bloqueado (ambíguo)', async () => {
    const { tenantId } = await seedTenant('portal-login-dup')
    const slug = 'clinica-portal-dup'
    await seedClinicProfile(tenantId, { slug })
    await seedPatientWithPii(tenantId, { cpf: CPF, birthDate: BIRTH_ISO, fullName: 'Dup Um' })
    await seedPatientWithPii(tenantId, { cpf: CPF, birthDate: BIRTH_ISO, fullName: 'Dup Dois' })

    const res = await loginPost(
      loginRequest({ slug, cpf: CPF, birthdate: BIRTH_DIGITS }, '10.0.5.1'),
    )
    expect(res.status).toBe(401) // genérico — nunca expõe o prontuário errado
  })

  it('slug desconhecido → 404 (sem vazamento de credencial)', async () => {
    const res = await loginPost(
      loginRequest({ slug: 'clinica-que-nao-existe', cpf: CPF, birthdate: BIRTH_DIGITS }, '10.0.6.1'),
    )
    expect(res.status).toBe(404)
  })

  it('sem consentimento LGPD → 400 CONSENT_REQUIRED (FR-005)', async () => {
    const res = await loginPost(
      loginRequest({ cpf: CPF, birthdate: BIRTH_DIGITS, lgpd_consent: false }, '10.0.7.1'),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CONSENT_REQUIRED')
  })
})

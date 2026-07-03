/**
 * T056 (Feature 012) — fluxo completo de cadastro manual + vínculo a doctor.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 012 — cadastro manual com vínculo a doctor', () => {
  let tenantId: string
  let adminJwt: string
  let doctorId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('manual-flow')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const d = await seedDoctor(tenantId, { crm: 'CRM-MANUAL' })
    doctorId = d.doctorId
  })

  async function postManual(body: unknown): Promise<Response> {
    const { POST } = await import('@/app/api/configuracoes/usuarios/manual/route')
    return POST(
      new Request('http://localhost/api/configuracoes/usuarios/manual', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify(body),
      }),
    )
  }

  it('cria usuário sem vínculo → 201; aparece em listTeamMembers sem linkedDoctor', async () => {
    const res = await postManual({
      full_name: 'Sem Vínculo',
      email: `noLink-${Date.now()}@test.local`,
      password: 'senha12345',
      role: 'recepcionista',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { linked_doctor: null }
    expect(body.linked_doctor).toBeNull()
  })

  it('cria usuário com vínculo → doctor.user_id setado + audit + linkedDoctor projetado', async () => {
    const email = `comLink-${Date.now()}@test.local`
    const res = await postManual({
      full_name: 'Dra. Ana',
      email,
      password: 'senha12345',
      role: 'profissional_saude',
      doctor_id: doctorId,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { user_id: string; linked_doctor: { id: string } | null }
    expect(body.linked_doctor?.id).toBe(doctorId)

    // Confirma DB: doctors.user_id setado
    const sb = serviceClient()
    const { data: d } = await sb.from('doctors').select('user_id').eq('id', doctorId).single()
    expect((d as { user_id: string | null }).user_id).toBe(body.user_id)

    // Audit
    const { data: audit } = await sb
      .from('audit_log')
      .select('reason, field')
      .eq('tenant_id', tenantId)
      .eq('entity_id', body.user_id)
    const reasons = (audit ?? []).map((a) => a.reason)
    expect(reasons.some((r) => r?.includes('manual user created'))).toBe(true)
  })

  it('cria 2º usuário com mesmo doctor → 409 DOCTOR_ALREADY_LINKED', async () => {
    const res = await postManual({
      full_name: 'Tenta vincular de novo',
      email: `dupLink-${Date.now()}@test.local`,
      password: 'senha12345',
      role: 'profissional_saude',
      doctor_id: doctorId,
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DOCTOR_ALREADY_LINKED')
  })

  it('senha curta → 400', async () => {
    const res = await postManual({
      full_name: 'Senha Curta',
      email: `short-${Date.now()}@test.local`,
      password: 'curta',
      role: 'recepcionista',
    })
    expect(res.status).toBe(400)
  })

  it('login funciona imediatamente com email + senha definida (sem confirmar email)', async () => {
    const email = `login-${Date.now()}@test.local`
    const password = 'senha12345'
    const res = await postManual({
      full_name: 'Pode Logar',
      email,
      password,
      role: 'recepcionista',
    })
    expect(res.status).toBe(201)

    // Tenta autenticar com supabase auth direto (anon key + signInWithPassword)
    const { createClient } = await import('@supabase/supabase-js')
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const client = createClient(SUPABASE_URL, ANON_KEY)
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    expect(error).toBeNull()
    expect(data.user?.email).toBe(email)
  })
})

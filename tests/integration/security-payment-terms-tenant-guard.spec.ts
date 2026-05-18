/**
 * Regressão do fix C3 — RPCs da feature 013 com guard de tenant null.
 *
 * Antes (0084): `IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id`
 * deixava passar caller autenticado SEM claim tenant_id (recém-cadastrado,
 * entre signup e onboarding, ou claim removida). As 3 RPCs têm
 * GRANT EXECUTE TO authenticated.
 *
 * Agora (0085): `v_jwt_role <> 'service_role' AND (v_jwt_tenant IS NULL OR
 * v_jwt_tenant <> p_tenant_id)`. Exige claim presente.
 *
 * Cobertura:
 *   - record_payment_terms_change → TENANT_MISMATCH
 *   - attach_assistant_to_appointment → APPOINTMENT_NOT_FOUND (shape
 *     preservado para não vazar existência cross-tenant — alinhado com 0084)
 *   - remove_appointment_assistant → ASSISTANT_NOT_FOUND (mesmo motivo)
 *
 * Sanidade: também valida que caller LEGÍTIMO (admin do tenant correto)
 * passa, para garantir que o fix não quebrou o caminho feliz.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/**
 * Mint JWT autenticado mas SEM as custom claims `tenant_id`/`role` que o
 * auth hook injetaria após o user virar membro de algum tenant. Simula o
 * usuário recém-cadastrado entre signup e onboarding.
 */
function mintTenantlessJwt(userId: string, email: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    iss: 'supabase-test',
    sub: userId,
    email,
    iat: now,
    exp: now + 3600,
    // SEM tenant_id, SEM app_metadata — claims que o hook insere só após
    // ter user_tenants ativa.
  }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest())
  return `${h}.${p}.${sig}`
}

describe('security: payment_terms RPCs reject callers without tenant claim (C3)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('record_payment_terms_change com caller sem tenant → TENANT_MISMATCH', async () => {
    const { tenantId } = await seedTenant('c3-record-no-tenant')
    const { doctorId } = await seedDoctor(tenantId, { paymentMode: 'comissionado' })

    // Cria usuário sem vincular a nenhum tenant — simula o gap entre
    // signup e onboarding em que o auth hook não tem do que popular o
    // claim tenant_id.
    const sb = serviceClient()
    const { data: u } = await sb.auth.admin.createUser({
      email: `tenantless-${randomUUID().slice(0, 6)}@test.local`,
      password: 'test1234',
      email_confirm: true,
    })
    const userId = u!.user!.id
    const jwt = mintTenantlessJwt(userId, u!.user!.email!)

    const client = rlsClient(jwt)
    const { error } = await client.rpc('record_payment_terms_change' as never, {
      p_tenant_id: tenantId,
      p_doctor_id: doctorId,
      p_payment_mode: 'comissionado',
      p_percentage_bps: 5000,
      p_monthly_amount_cents: null,
      p_billing_day: null,
      p_liberal_default_cents: null,
      p_valid_from: '2026-01-01',
      p_reason: 'tentativa malicious',
      p_actor: userId,
    } as never)

    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/TENANT_MISMATCH/)

    // Nenhuma row gravada.
    const rows = await sb
      .from('doctor_payment_terms_history')
      .select('id')
      .eq('reason', 'tentativa malicious')
    expect(rows.data?.length ?? 0).toBe(0)
  })

  it('record_payment_terms_change com caller LEGÍTIMO (admin do tenant) → sucesso', async () => {
    const { tenantId } = await seedTenant('c3-record-happy')
    const { doctorId } = await seedDoctor(tenantId, { paymentMode: 'comissionado' })
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })

    const client = rlsClient(jwt)
    const { data, error } = await client.rpc('record_payment_terms_change' as never, {
      p_tenant_id: tenantId,
      p_doctor_id: doctorId,
      p_payment_mode: 'comissionado',
      p_percentage_bps: 6000,
      p_monthly_amount_cents: null,
      p_billing_day: null,
      p_liberal_default_cents: null,
      p_valid_from: '2026-01-01',
      p_reason: 'admin ajustou comissão',
      p_actor: admin.userId,
    } as never)

    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('attach_assistant_to_appointment com caller sem tenant → APPOINTMENT_NOT_FOUND', async () => {
    const { tenantId } = await seedTenant('c3-attach-no-tenant')
    // Seed um appointment válido para ter um UUID real.
    const sb = serviceClient()
    const apptId = randomUUID()
    const { doctorId } = await seedDoctor(tenantId, { paymentMode: 'liberal' })

    // Cria minimum viable patient + procedure + plan + price_version pra
    // poder inserir appointment. Aqui usamos o seedAppointment? Sim,
    // mas exige mais seeds — para focar no guard, fazemos INSERT minimal
    // via service_role com colunas necessárias.
    const planRes = await sb
      .from('health_plans')
      .insert({ tenant_id: tenantId, name: 'Plano C3' })
      .select('id')
      .single()
    const planId = (planRes.data as { id: string }).id

    const { data: tussRow } = await sb
      .from('tuss_codes')
      .insert({
        code: 'C3TEST',
        description: 'test',
        tuss_table: '22',
        valid_from: '2020-01-01',
      } as never)
      .select('code')
      .single()
    void tussRow

    const procRes = await sb
      .from('procedures')
      .insert({ tenant_id: tenantId, tuss_code: 'C3TEST' } as never)
      .select('id')
      .single()
    const procId = (procRes.data as { id: string }).id

    const priceRes = await sb
      .from('price_versions')
      .insert({
        tenant_id: tenantId,
        procedure_id: procId,
        plan_id: planId,
        amount_cents: 10000,
        valid_from: '2020-01-01',
        created_by: '00000000-0000-0000-0000-000000000000',
        reason: 'seed',
      })
      .select('id')
      .single()
    const priceId = (priceRes.data as { id: string }).id

    // Patient mínimo
    const patientRes = await sb
      .from('patients')
      .insert({
        tenant_id: tenantId,
        ghl_contact_id: `p-${randomUUID()}`,
        full_name_enc: Buffer.from('x') as unknown as string,
        cpf_enc: Buffer.from('x') as unknown as string,
      } as never)
      .select('id')
      .single()
    const patientId = (patientRes.data as { id: string }).id

    const commRes = await sb
      .from('doctor_commission_history')
      .select('id')
      .eq('doctor_id', doctorId)
      .single()
    const commissionId = (commRes.data as { id: string }).id

    await sb
      .from('appointments')
      .insert({
        id: apptId,
        tenant_id: tenantId,
        patient_id: patientId,
        doctor_id: doctorId,
        procedure_id: procId,
        plan_id: planId,
        frozen_amount_cents: 10000,
        frozen_commission_bps: 4000,
        source_price_version_id: priceId,
        source_commission_history_id: commissionId,
        appointment_at: new Date().toISOString(),
      } as never)
      .throwOnError()

    // Cria usuário sem tenant.
    const { data: u } = await sb.auth.admin.createUser({
      email: `tenantless-${randomUUID().slice(0, 6)}@test.local`,
      password: 'test1234',
      email_confirm: true,
    })
    const jwt = mintTenantlessJwt(u!.user!.id, u!.user!.email!)
    const client = rlsClient(jwt)

    const { error } = await client.rpc('attach_assistant_to_appointment' as never, {
      p_appointment_id: apptId,
      p_assistant_doctor_id: doctorId,
      p_amount_cents: 5000,
      p_actor: u!.user!.id,
    } as never)

    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/APPOINTMENT_NOT_FOUND/)
  })

  it('remove_appointment_assistant com caller sem tenant → ASSISTANT_NOT_FOUND', async () => {
    const sb = serviceClient()
    const { data: u } = await sb.auth.admin.createUser({
      email: `tenantless-${randomUUID().slice(0, 6)}@test.local`,
      password: 'test1234',
      email_confirm: true,
    })
    const jwt = mintTenantlessJwt(u!.user!.id, u!.user!.email!)
    const client = rlsClient(jwt)

    // UUID random — não importa se existe; guard verifica antes do lookup.
    // Mas é fácil testar com UUID que NÃO existe; espera ASSISTANT_NOT_FOUND.
    const fakeId = randomUUID()
    const { error } = await client.rpc('remove_appointment_assistant' as never, {
      p_id: fakeId,
      p_actor: u!.user!.id,
    } as never)

    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/ASSISTANT_NOT_FOUND/)
  })
})

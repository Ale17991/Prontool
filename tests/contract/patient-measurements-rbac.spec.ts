/**
 * T014 (Feature 030) — RBAC de `patient_measurements` (FR-014).
 *
 * Constitution Principle V: RLS WITH CHECK exige jwt_role() IN
 * ('admin','profissional_saude') no INSERT. Recepcionista/financeiro não
 * registram medição — nem direto no banco (RLS) nem via rota (requireRole,
 * testado em staff-record-metabolic-metric.spec.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 030 — RBAC de patient_measurements', () => {
  let tenantId: string
  let patientId: string
  const jwts: Partial<Record<TenantRole, { jwt: string; userId: string }>> = {}

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('pm-rbac')).tenantId
    patientId = await seedPatient(tenantId)
    const roles: TenantRole[] = ['admin', 'profissional_saude', 'recepcionista', 'financeiro']
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      jwts[role] = {
        userId: u.userId,
        jwt: mintJwt({ userId: u.userId, email: u.email, tenantId, role }),
      }
    }
  })

  function insertAs(role: TenantRole) {
    const { jwt, userId } = jwts[role]!
    return rlsClient(jwt)
      .from('patient_measurements')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        metric_type: 'glicemia_jejum',
        value: 110,
        unit: 'mg/dL',
        measured_at: '2026-05-10',
        created_by_user_id: userId,
      })
  }

  it('admin insere medição', async () => {
    const { error } = await insertAs('admin')
    expect(error).toBeNull()
  })

  it('profissional_saude insere medição', async () => {
    const { error } = await insertAs('profissional_saude')
    expect(error).toBeNull()
  })

  it('recepcionista NÃO insere medição (RLS)', async () => {
    const { error } = await insertAs('recepcionista')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/policy|denied|security/i)
  })

  it('financeiro NÃO insere medição (RLS)', async () => {
    const { error } = await insertAs('financeiro')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/policy|denied|security/i)
  })

  it('staff de outro tenant não lê as medições deste tenant (RLS)', async () => {
    const otherTenant = (await seedTenant('pm-rbac-other')).tenantId
    const u = await seedUser(otherTenant, 'admin')
    const outsider = rlsClient(
      mintJwt({ userId: u.userId, email: u.email, tenantId: otherTenant, role: 'admin' }),
    )
    const { data, error } = await outsider
      .from('patient_measurements')
      .select('id')
      .eq('tenant_id', tenantId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })
})

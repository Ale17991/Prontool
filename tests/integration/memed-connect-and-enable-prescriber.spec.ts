/**
 * T019 (Feature 026) — connect + habilitar prescritor (integração com mock Memed).
 *
 * Caminho feliz: conectar a clínica e habilitar um profissional com cadastro
 * completo → memed_prescribers.status='registered' + audit_log.
 * Caminho de bloqueio: profissional sem CPF → erro de campos faltantes
 * (sem chamar a Memed).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mockMemed, setDoctorPrescriberFields } from '@/tests/helpers/memed-mock'
import { activateMemed } from '@/lib/core/integrations/memed/connect'
import { enablePrescriber } from '@/lib/core/integrations/memed/register-prescriber'

describe('Feature 026 — connect + enable prescriber', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('conecta e habilita um profissional com cadastro completo', async () => {
    mockMemed()
    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-enable')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId } = await seedDoctor(tenantId)
    await setDoctorPrescriberFields(doctorId, tenantId)

    await activateMemed({
      supabase: sb,
      tenantId,
      environment: 'staging',
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })

    const result = await enablePrescriber({
      supabase: sb,
      tenantId,
      doctorId,
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })
    expect(result.status).toBe('registered')

    const { data: prescriber } = await sb
      .from('memed_prescribers')
      .select('status, external_id')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
      .maybeSingle()
    expect((prescriber as { status?: string } | null)?.status).toBe('registered')

    const { data: audit } = await sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', tenantId)
      .eq('field', 'memed.prescriber.enable')
    expect((audit ?? []).length).toBeGreaterThan(0)
  })

  it('bloqueia habilitar profissional sem CPF (sem chamar a Memed)', async () => {
    mockMemed()
    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-missing')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId } = await seedDoctor(tenantId) // sem campos de prescritor

    await activateMemed({
      supabase: sb,
      tenantId,
      environment: 'staging',
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })

    await expect(
      enablePrescriber({
        supabase: sb,
        tenantId,
        doctorId,
        actorUserId: admin.userId,
        actorLabel: `user:${admin.email}`,
      }),
    ).rejects.toMatchObject({ code: 'MEMED_PRESCRIBER_FIELDS_MISSING' })
  })
})

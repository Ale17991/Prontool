/**
 * T031 (Feature 027 / US5, FR-014) — quando a Memed falha (upstream 5xx), o
 * erro que volta NÃO contém credenciais (api_key/secret_key/mk_...). O usuário
 * recebe mensagem genérica.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import {
  mockMemed,
  seedMemedConnection,
  setDoctorPrescriberFields,
} from '@/tests/helpers/memed-mock'
import { enablePrescriber } from '@/lib/core/integrations/memed/register-prescriber'

function leaks(s: string): boolean {
  return /api[_-]?key|secret[_-]?key|mk_[A-Za-z0-9]{20,}/i.test(s)
}

describe('Feature 027 — erros não vazam credenciais (C7)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('falha upstream da Memed → erro genérico, sem api_key/secret_key', async () => {
    mockMemed({ registerStatus: 500 }) // Memed responde 5xx no POST /usuarios
    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-err')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId } = await seedDoctor(tenantId)
    await setDoctorPrescriberFields(doctorId, tenantId)
    await seedMemedConnection(tenantId, { createdBy: admin.userId })

    let caught: unknown
    try {
      await enablePrescriber({
        supabase: sb,
        tenantId,
        doctorId,
        actorUserId: admin.userId,
        actorLabel: `user:${admin.email}`,
      })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeTruthy()
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).not.toMatch(/api[_-]?key|secret[_-]?key|mk_/i)
    expect(message.toLowerCase()).toContain('memed') // mensagem amigável ("Memed indisponível…")

    // E o estado de erro persistido (last_error) também não vaza credencial.
    const { data } = await sb
      .from('memed_prescribers')
      .select('status, last_error')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
      .maybeSingle()
    const row = data as { status?: string; last_error?: string } | null
    expect(row?.status).toBe('error')
    expect(leaks(row?.last_error ?? '')).toBe(false)
  })
})

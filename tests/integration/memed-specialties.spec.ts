/**
 * US4 (Feature 026) — de-para de especialidade.
 *  - listMemedSpecialties devolve o catálogo `[{ id, nome }]` (proxy server-side).
 *  - enablePrescriber com memedSpecialtyId persiste em memed_prescribers.
 *  - sem mapeamento, registra sem especialidade (não bloqueia).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mockMemed, setDoctorPrescriberFields } from '@/tests/helpers/memed-mock'
import { listMemedSpecialties } from '@/lib/core/integrations/memed/list-specialties'
import { connectMemed } from '@/lib/core/integrations/memed/connect'
import { enablePrescriber } from '@/lib/core/integrations/memed/register-prescriber'

async function connected(slug: string) {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  await connectMemed({
    supabase: sb,
    tenantId,
    credentials: { api_key: 'k', secret_key: 's' },
    actorUserId: admin.userId,
    actorLabel: `user:${admin.email}`,
  })
  return { sb, tenantId, admin }
}

describe('Feature 026 — especialidades (US4)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('lista o catálogo de especialidades da Memed', async () => {
    mockMemed({ specialties: [{ id: '99', nome: 'Dermatologia' }] })
    const { sb, tenantId } = await connected('memed-spec-list')
    const list = await listMemedSpecialties(sb, tenantId)
    expect(list).toEqual([{ id: '99', nome: 'Dermatologia' }])
  })

  it('persiste memed_specialty_id ao habilitar com especialidade', async () => {
    mockMemed()
    const { sb, tenantId, admin } = await connected('memed-spec-enable')
    const { doctorId } = await seedDoctor(tenantId)
    await setDoctorPrescriberFields(doctorId, tenantId)

    await enablePrescriber({
      supabase: sb,
      tenantId,
      doctorId,
      memedSpecialtyId: '10',
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })

    const { data } = await sb
      .from('memed_prescribers')
      .select('memed_specialty_id, status')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
      .maybeSingle()
    expect((data as { memed_specialty_id?: string } | null)?.memed_specialty_id).toBe('10')
    expect((data as { status?: string } | null)?.status).toBe('registered')
  })
})

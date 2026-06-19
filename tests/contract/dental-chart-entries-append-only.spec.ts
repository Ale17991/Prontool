/**
 * Feature 039 (US1/FR-016, SC-005) — dental_chart_entries é append-only.
 *
 * Garantia em duas camadas:
 *   (a) o trigger `enforce_append_only_columns('')` rejeita UPDATE/DELETE
 *       inclusive via service-role (não há exceção de role);
 *   (b) usuário autenticado não tem policy de UPDATE/DELETE → a operação é
 *       no-op (0 linhas), nunca altera o registro.
 * Correção = nova linha.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('dental_chart_entries — append-only', () => {
  let tenantId: string
  let adminJwt: string
  let entryId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant()
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const { data: status } = await sb
      .from('dental_status_catalog')
      .select('id')
      .eq('code', 'caries')
      .single()
    const { data: entry } = await sb
      .from('dental_chart_entries')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        tooth_fdi: 16,
        surface: 'occlusal_incisal',
        status_id: (status as { id: string }).id,
        created_by: admin.userId,
      })
      .select('id')
      .single()
    entryId = (entry as { id: string }).id
  })

  it('UPDATE via service-role é rejeitado pelo trigger', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('dental_chart_entries')
      .update({ note: 'tentativa de edição' })
      .eq('id', entryId)
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/append-only|permission|forbidden|violates/)
  })

  it('DELETE via service-role é rejeitado pelo trigger', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('dental_chart_entries').delete().eq('id', entryId)
    expect(error).not.toBeNull()
  })

  it('usuário autenticado não altera o registro (no-op por RLS)', async () => {
    const sb = rlsClient(adminJwt)
    await sb.from('dental_chart_entries').update({ note: 'hack' }).eq('id', entryId)
    // O registro permanece intacto (note nunca foi setado).
    const { data } = await serviceClient()
      .from('dental_chart_entries')
      .select('note')
      .eq('id', entryId)
      .single()
    expect((data as { note: string | null }).note).toBeNull()
  })
})

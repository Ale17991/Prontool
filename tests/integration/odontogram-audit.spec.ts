/**
 * Feature 039 (US3/FR-019, Princípio II) — toda marcação gera trilha de
 * auditoria em audit_log (entity dental_chart_entries, field created).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'

describe('odontograma — auditoria de marcação', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('INSERT de marcação gera entrada em audit_log', async () => {
    const t = await seedTenant()
    const user = await seedUser(t.tenantId, 'profissional_saude')
    const patientId = await seedPatient(t.tenantId)
    const sb = serviceClient()
    const { data: status } = await sb
      .from('dental_status_catalog')
      .select('id')
      .eq('code', 'caries')
      .single()
    const { data: entry } = await sb
      .from('dental_chart_entries')
      .insert({
        tenant_id: t.tenantId,
        patient_id: patientId,
        tooth_fdi: 16,
        surface: 'occlusal_incisal',
        status_id: (status as { id: string }).id,
        created_by: user.userId,
      })
      .select('id')
      .single()

    const { data: audit } = await sb
      .from('audit_log')
      .select('entity, entity_id, field')
      .eq('entity', 'dental_chart_entries')
      .eq('entity_id', (entry as { id: string }).id)

    expect((audit ?? []).length).toBeGreaterThan(0)
    expect((audit as Array<{ field: string }>)[0]?.field).toBe('created')
  })
})

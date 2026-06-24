/**
 * Feature 041 (US1) — Periograma: imutabilidade e regras de banco.
 *
 * Garantias (valem inclusive via service-role — triggers sem exceção de role):
 *   - no máximo um rascunho por paciente (índice único parcial);
 *   - exame finalizado é imutável (não atualiza header nem medições/achados);
 *   - faixas plausíveis (PD 0–15, recessão −5..15) via CHECK;
 *   - transição só rascunho→finalizado.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'

describe('perio_exams — imutabilidade e regras', () => {
  let tenantId: string
  let patientId: string
  let userId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant()
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    userId = admin.userId
    patientId = await seedPatient(tenantId)
  })

  it('rejeita um segundo rascunho para o mesmo paciente', async () => {
    const sb = serviceClient()
    const first = await sb.from('perio_exams').insert({ tenant_id: tenantId, patient_id: patientId, created_by: userId }).select('id').single()
    expect(first.error).toBeNull()

    const second = await sb.from('perio_exams').insert({ tenant_id: tenantId, patient_id: patientId, created_by: userId })
    expect(second.error).not.toBeNull()
    expect(second.error?.code).toBe('23505')
  })

  it('rejeita profundidade fora da faixa (0–15)', async () => {
    const sb = serviceClient()
    const { data: exam } = await sb.from('perio_exams').select('id').eq('tenant_id', tenantId).eq('patient_id', patientId).eq('status', 'rascunho').single()
    const bad = await sb.from('perio_site_measurements').insert({
      tenant_id: tenantId, exam_id: exam!.id, tooth_fdi: 16, site: 'b', probing_depth_mm: 20,
    })
    expect(bad.error).not.toBeNull()
  })

  it('congela o exame ao finalizar (header e medições imutáveis)', async () => {
    const sb = serviceClient()
    const { data: exam } = await sb.from('perio_exams').select('id').eq('tenant_id', tenantId).eq('patient_id', patientId).eq('status', 'rascunho').single()
    const examId = exam!.id

    // medição válida em rascunho
    const ok = await sb.from('perio_site_measurements').insert({
      tenant_id: tenantId, exam_id: examId, tooth_fdi: 16, site: 'mb', probing_depth_mm: 3, recession_mm: 1, bleeding: true,
    })
    expect(ok.error).toBeNull()

    // finaliza
    const fin = await sb.from('perio_exams').update({ status: 'finalizado', finalized_at: new Date().toISOString(), finalized_by: userId }).eq('id', examId).select('status').single()
    expect(fin.error).toBeNull()
    expect(fin.data?.status).toBe('finalizado')

    // header imutável
    const upd = await sb.from('perio_exams').update({ notes: 'depois' }).eq('id', examId)
    expect(upd.error).not.toBeNull()

    // nova medição bloqueada
    const blocked = await sb.from('perio_site_measurements').insert({
      tenant_id: tenantId, exam_id: examId, tooth_fdi: 17, site: 'b', probing_depth_mm: 2,
    })
    expect(blocked.error).not.toBeNull()

    // DELETE de finalizado bloqueado
    const del = await sb.from('perio_exams').delete().eq('id', examId)
    expect(del.error).not.toBeNull()
  })
})

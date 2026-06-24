/**
 * Feature 041 (US2/FR-009) — comparação entre dois exames finalizados:
 * variação de profundidade por sítio e deltas de indicadores.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { comparePerioExams } from '@/lib/core/dental/perio/compare-exams'

async function makeFinalizedExam(
  sb: ReturnType<typeof serviceClient>,
  tenantId: string,
  patientId: string,
  userId: string,
  pd: number,
): Promise<string> {
  const { data: exam } = await sb
    .from('perio_exams')
    .insert({ tenant_id: tenantId, patient_id: patientId, created_by: userId })
    .select('id')
    .single()
  const examId = exam!.id
  await sb.from('perio_site_measurements').insert({
    tenant_id: tenantId, exam_id: examId, tooth_fdi: 16, site: 'mb', probing_depth_mm: pd, bleeding: pd >= 4,
  })
  await sb.from('perio_exams').update({ status: 'finalizado', finalized_at: new Date().toISOString(), finalized_by: userId }).eq('id', examId)
  return examId
}

describe('periograma — comparação de exames', () => {
  let tenantId: string
  let patientId: string
  let userId: string
  let fromId: string
  let toId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant()
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    userId = admin.userId
    patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    fromId = await makeFinalizedExam(sb, tenantId, patientId, userId, 5) // bolsa + sangramento
    toId = await makeFinalizedExam(sb, tenantId, patientId, userId, 3) // melhora
  })

  it('calcula deltaPd por sítio e deltas de indicadores', async () => {
    const sb = serviceClient()
    const res = await comparePerioExams(sb, { tenantId, patientId, fromExamId: fromId, toExamId: toId })
    const site = res.sites.find((s) => s.toothFdi === 16 && s.site === 'mb')
    expect(site?.fromPd).toBe(5)
    expect(site?.toPd).toBe(3)
    expect(site?.deltaPd).toBe(-2)
    expect(res.deltas.pocketsGe4).toBe(-1) // 1 bolsa → 0
    expect(res.deltas.bopPct).toBeLessThan(0)
  })

  it('rejeita comparar exame com ele mesmo', async () => {
    const sb = serviceClient()
    await expect(
      comparePerioExams(sb, { tenantId, patientId, fromExamId: fromId, toExamId: fromId }),
    ).rejects.toThrow()
  })
})

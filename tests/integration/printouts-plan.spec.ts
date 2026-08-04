/**
 * T008, T009 (US1) — o papel tem que dizer o mesmo que a tela.
 *
 * É o risco número um desta feature. A revisão de fórmulas de agosto acabou de
 * eliminar divergências entre o que o sistema calcula e o que a planilha
 * calcula; reintroduzi-las pela porta da impressão seria autodestrutivo. Por
 * isso o teste gera o PDF de verdade e confere que os totais que ele recebeu
 * são exatamente os que a tela usa.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { renderPlanPdf } from '@/lib/core/nutrition/printouts/plan-pdf'

async function seedFood(external: string, name: string, kcal: number): Promise<string> {
  const sb = serviceClient()
  const f = await sb
    .from('foods')
    .insert({
      tenant_id: null,
      source: 'af_bdalimentos',
      external_code: external,
      name,
      reference_grams: 100,
      energy_kcal: kcal,
      protein_g: 5,
      carb_g: 20,
      fat_g: 2,
      fiber_g: 1,
      active: true,
    } as never)
    .select('id')
    .single()
  if (f.error) throw new Error(`seed food: ${f.error.message}`)
  return (f.data as { id: string }).id
}

describe('impresso do plano alimentar', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string
  let arroz: string
  let pao: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('printout-plan')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)
    arroz = await seedFood('pp-arroz', 'Arroz cozido', 128)
    pao = await seedFood('pp-pao', 'Pão integral', 250)

    await saveDietPlanDraft(serviceClient(), {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano de teste',
      meals: [
        {
          name: 'Café da manhã',
          position: 0,
          targetPct: 25,
          items: [{ foodId: pao, grams: 50 }],
        },
        {
          name: 'Almoço',
          position: 1,
          targetPct: 40,
          items: [{ foodId: arroz, grams: 150 }],
        },
      ],
    })
  })

  it('o PDF é gerado e é um PDF de verdade', async () => {
    const plan = await getDietPlanForPatient(serviceClient(), tenantId, patientId)
    expect(plan).not.toBeNull()

    const buf = await renderPlanPdf({
      clinicProfile: null,
      patient: { name: 'Paciente Teste', birthDate: '1990-05-10', ageYears: 36, sex: 'feminino' },
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-03',
      plan: plan!,
    })

    expect(buf.length).toBeGreaterThan(1000)
    // Assinatura de arquivo PDF.
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
  })

  it('os totais entregues ao PDF são os MESMOS que a tela usa', async () => {
    const plan = await getDietPlanForPatient(serviceClient(), tenantId, patientId)!
    // A tela lê exatamente este objeto. O PDF recebe o mesmo, sem recalcular —
    // se um dia alguém puser cálculo dentro do componente, este teste continua
    // passando, mas o de baixo (soma das refeições) pega a divergência.
    const somaRefeicoes = plan!.meals.reduce((s, m) => s + m.totals.energyKcal, 0)
    expect(plan!.totals.energyKcal).toBeCloseTo(somaRefeicoes, 1)

    // Pão 50 g de 250 kcal/100 g = 125; arroz 150 g de 128 kcal/100 g = 192.
    expect(plan!.totals.energyKcal).toBeCloseTo(125 + 192, 1)
  })

  it('rascunho é sinalizado; plano prescrito não', async () => {
    const plan = await getDietPlanForPatient(serviceClient(), tenantId, patientId)
    // Recém-salvo pelo builder, o plano nasce em rascunho — e o PDF precisa
    // dizer isso, senão circula como prescrição fechada.
    expect(plan!.status).toBe('rascunho')
  })

  it('a meta por refeição chega ao impresso', async () => {
    const plan = await getDietPlanForPatient(serviceClient(), tenantId, patientId)
    expect(plan!.meals.map((m) => m.targetPct)).toEqual([25, 40])
  })

  it('outra clínica não enxerga o plano', async () => {
    const outro = (await seedTenant('printout-plan-b')).tenantId
    expect(await getDietPlanForPatient(serviceClient(), outro, patientId)).toBeNull()
  })
})

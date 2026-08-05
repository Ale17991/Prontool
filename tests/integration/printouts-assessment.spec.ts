/**
 * T015, T016 (US2) — evolução da avaliação.
 *
 * Dois riscos aqui, e nenhum é de cálculo: mostrar histórico que não existe, e
 * pôr lado a lado números obtidos por métodos incomparáveis. Os dois enganam o
 * paciente sem produzir nenhum erro visível.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { listAssessmentsForPrintout } from '@/lib/core/nutrition/assessments/for-printout'
import { renderAssessmentPdf, variation } from '@/lib/core/nutrition/printouts/assessment-pdf'

const PACIENTE = {
  name: 'Paciente Teste',
  birthDate: '1990-05-10',
  ageYears: 36,
  sex: 'feminino',
}

async function seedAssessment(args: {
  tenantId: string
  patientId: string
  userId: string
  assessedAt: string
  weightKg: number
  fatPct: number
  leanMassKg: number
  protocol: string
}): Promise<void> {
  const sb = serviceClient()
  const { error } = await sb.from('nutrition_assessments').insert({
    tenant_id: args.tenantId,
    patient_id: args.patientId,
    assessed_at: args.assessedAt,
    sex: 'F',
    age_years: 36,
    weight_kg: args.weightKg,
    height_cm: 165,
    skinfolds: {},
    circumferences: { cintura: 78, quadril: 100 },
    dobra_protocol: args.protocol,
    fat_pct: args.fatPct,
    lean_mass_kg: args.leanMassKg,
    imc: 24.2,
    imc_class: 'Eutrofia',
    tmb_equation: 'mifflin',
    tmb_kcal: 1400,
    get_kcal: 2100,
    target_kcal: 1900,
    created_by_user_id: args.userId,
  } as never)
  if (error) throw new Error(`seed assessment: ${error.message}`)
}

describe('impresso de evolução da avaliação', () => {
  let tenantId: string
  let patientId: string
  let userId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('printout-assess')).tenantId
    userId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)

    // Cinco avaliações: o impresso deve usar só as três mais recentes.
    const dados: Array<[string, number, number, number, string]> = [
      ['2026-01-10', 78, 32, 50, 'durnin_womersley'],
      ['2026-03-10', 76, 30.5, 51, 'durnin_womersley'],
      ['2026-05-10', 74, 29, 52, 'durnin_womersley'],
      ['2026-07-10', 72, 27.5, 52.5, 'durnin_womersley'],
      ['2026-08-01', 71, 26, 53, 'bioimpedancia'],
    ]
    for (const [assessedAt, weightKg, fatPct, leanMassKg, protocol] of dados) {
      await seedAssessment({ tenantId, patientId, userId, assessedAt, weightKg, fatPct, leanMassKg, protocol })
    }
  })

  it('usa as três mais recentes, da mais antiga para a mais nova', async () => {
    const list = await listAssessmentsForPrintout(serviceClient(), { tenantId, patientId })
    expect(list.map((a) => a.assessedAt)).toEqual(['2026-05-10', '2026-07-10', '2026-08-01'])
  })

  it('o limite é 3, mesmo pedindo mais', async () => {
    const list = await listAssessmentsForPrintout(serviceClient(), {
      tenantId,
      patientId,
      limit: 10,
    })
    expect(list).toHaveLength(3)
  })

  it('toda avaliação carrega o método — sem ele as colunas não se comparam', async () => {
    const list = await listAssessmentsForPrintout(serviceClient(), { tenantId, patientId })
    // A última é bioimpedância e as outras são dobras: pôr lado a lado sem
    // dizer o método faria trocar de instrumento parecer evolução.
    expect(list.map((a) => a.dobraProtocol)).toEqual([
      'durnin_womersley',
      'durnin_womersley',
      'bioimpedancia',
    ])
  })

  it('a variação é calculada entre a primeira e a última coluna', async () => {
    const list = await listAssessmentsForPrintout(serviceClient(), { tenantId, patientId })
    // 74 kg em 10/05 → 71 kg em 01/08.
    expect(variation(list[0], list[list.length - 1], (a) => a.weightKg)).toBeCloseTo(-3, 6)
    expect(variation(list[0], list[list.length - 1], (a) => a.fatPct)).toBeCloseTo(-3, 6)
  })

  it('sem duas pontas não há variação — não se inventa tendência', async () => {
    const list = await listAssessmentsForPrintout(serviceClient(), { tenantId, patientId })
    const so = list[0]!
    expect(variation(so, so, (a) => a.weightKg)).toBeNull()
    expect(variation(undefined, so, (a) => a.weightKg)).toBeNull()
  })

  it('gera um PDF de verdade', async () => {
    const list = await listAssessmentsForPrintout(serviceClient(), { tenantId, patientId })
    const buf = await renderAssessmentPdf({
      clinicProfile: null,
      patient: PACIENTE,
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      assessments: list,
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('com uma única avaliação, sai uma coluna e nenhuma variação', async () => {
    const outroPaciente = await seedPatient(tenantId)
    await seedAssessment({
      tenantId,
      patientId: outroPaciente,
      userId,
      assessedAt: '2026-08-01',
      weightKg: 80,
      fatPct: 25,
      leanMassKg: 60,
      protocol: 'faulkner',
    })
    const list = await listAssessmentsForPrintout(serviceClient(), {
      tenantId,
      patientId: outroPaciente,
    })
    expect(list).toHaveLength(1)
    // Coluna vazia sugeriria histórico inexistente.
    expect(variation(list[0], list[0], (a) => a.weightKg)).toBeNull()

    const buf = await renderAssessmentPdf({
      clinicProfile: null,
      patient: PACIENTE,
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      assessments: list,
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
  })

  it('outra clínica não enxerga as avaliações', async () => {
    const outro = (await seedTenant('printout-assess-b')).tenantId
    const list = await listAssessmentsForPrintout(serviceClient(), {
      tenantId: outro,
      patientId,
    })
    expect(list).toHaveLength(0)
  })
})

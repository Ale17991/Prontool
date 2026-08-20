/**
 * Curvas de crescimento — leitura ponta a ponta.
 *
 * Autossuficiente: insere os percentis que usa, porque o reset trunca catálogos
 * globais restaurando de um baseline que pode ser anterior a esta migration.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedPatient, seedUser } from '@/tests/helpers/seed-factories'
import { buildGrowthReport } from '@/lib/core/growth/read'

/** Percentis sintéticos, fáceis de conferir de cabeça: p50 = 10 + mês. */
function seedRows(indicator: string, sex: 'M' | 'F') {
  const rows = []
  for (let m = 0; m <= 60; m++) {
    const base = 10 + m
    rows.push({
      indicator,
      sex,
      age_months: m,
      p01: base - 5,
      p3: base - 4,
      p5: base - 3,
      p10: base - 2,
      p15: base - 1,
      p50: base,
      p85: base + 1,
      p97: base + 2,
      p999: base + 3,
    })
  }
  return rows
}

describe('curvas de crescimento', () => {
  let tenantId: string
  let patientId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('growth')).tenantId
    patientId = await seedPatient(tenantId)
    const actor = await seedUser(tenantId, 'profissional_saude')

    const sb = serviceClient()
    const ins = await sb
      .from('growth_percentiles')
      .upsert(
        [
          ...seedRows('peso_idade', 'M'),
          ...seedRows('estatura_idade', 'M'),
          ...seedRows('imc_idade', 'M'),
        ] as never,
        { onConflict: 'indicator,sex,age_months' },
      )
    if (ins.error) throw new Error(`seed percentis: ${ins.error.message}`)

    // Aferição aos 12 meses exatos.
    const v = await sb.from('vital_signs').insert({
      tenant_id: tenantId,
      patient_id: patientId,
      measured_at: '2025-01-01T10:00:00Z',
      // `bmi` é coluna GERADA — não se insere. Com 22 kg e 1,00 m ela sai 22,
      // que é exatamente o p50 do mês 12 na tabela sintética acima.
      weight_grams: 22000,
      height_cm: 100,
      measured_by: actor.userId,
    } as never)
    if (v.error) throw new Error(`seed vitals: ${v.error.message}`)
  })

  it('classifica no percentil 50 quando o valor bate a mediana', async () => {
    const r = await buildGrowthReport(serviceClient(), {
      tenantId,
      patientId,
      birthDate: '2024-01-01',
      sex: 'masculino',
      today: '2025-02-01',
    })
    const peso = r.curves.find((c) => c.indicator === 'peso_idade')!
    expect(peso.points).toHaveLength(1)
    expect(peso.points[0]!.percentile).toBeCloseTo(50, 1)
    expect(peso.latest!.classification).toBe('adequado')

    const imc = r.curves.find((c) => c.indicator === 'imc_idade')!
    expect(imc.points[0]!.percentile).toBeCloseTo(50, 1)
    expect(imc.latest!.label).toBe('Eutrofia')
  })

  it('aceita o sexo em português do cadastro', async () => {
    const r = await buildGrowthReport(serviceClient(), {
      tenantId,
      patientId,
      birthDate: '2024-01-01',
      sex: 'masculino',
      today: '2025-02-01',
    })
    expect(r.curves.length).toBeGreaterThan(0)
    expect(r.missing.sex).toBe(false)
  })

  it('sem nascimento ou sexo NÃO chuta — devolve o que falta', async () => {
    const semData = await buildGrowthReport(serviceClient(), {
      tenantId,
      patientId,
      birthDate: null,
      sex: 'masculino',
      today: '2025-02-01',
    })
    expect(semData.curves).toHaveLength(0)
    expect(semData.missing.birthDate).toBe(true)

    const semSexo = await buildGrowthReport(serviceClient(), {
      tenantId,
      patientId,
      birthDate: '2024-01-01',
      sex: null,
      today: '2025-02-01',
    })
    expect(semSexo.missing.sex).toBe(true)
  })

  it('intersexo não escolhe curva por conta própria', async () => {
    const r = await buildGrowthReport(serviceClient(), {
      tenantId,
      patientId,
      birthDate: '2024-01-01',
      sex: 'intersexo',
      today: '2025-02-01',
    })
    // Escolher uma das duas curvas seria decidir clinicamente no lugar da
    // profissional.
    expect(r.missing.sex).toBe(true)
    expect(r.curves).toHaveLength(0)
  })

  it('adulto sai marcado como fora da faixa pediátrica', async () => {
    const r = await buildGrowthReport(serviceClient(), {
      tenantId,
      patientId,
      birthDate: '1990-01-01',
      sex: 'masculino',
      today: '2025-02-01',
    })
    expect(r.outOfRange).toBe(true)
    expect(r.curves).toHaveLength(0)
  })

  it('outra clínica não enxerga as aferições', async () => {
    const outro = (await seedTenant('growth-b')).tenantId
    const r = await buildGrowthReport(serviceClient(), {
      tenantId: outro,
      patientId,
      birthDate: '2024-01-01',
      sex: 'masculino',
      today: '2025-02-01',
    })
    expect(r.curves.every((c) => c.points.length === 0)).toBe(true)
  })
})

describe('acompanhamento é opt-in por paciente', () => {
  it('a coluna nasce desligada e o toggle liga/desliga', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('growth-toggle')).tenantId
    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()

    const inicial = await sb
      .from('patients')
      .select('growth_tracking_enabled')
      .eq('id', patientId)
      .single()
    // Numa clínica de adultos a curva não pode brotar sozinha.
    expect((inicial.data as { growth_tracking_enabled: boolean }).growth_tracking_enabled).toBe(
      false,
    )

    await sb
      .from('patients')
      .update({ growth_tracking_enabled: true } as never)
      .eq('tenant_id', tenantId)
      .eq('id', patientId)
    const ligado = await sb
      .from('patients')
      .select('growth_tracking_enabled')
      .eq('id', patientId)
      .single()
    expect((ligado.data as { growth_tracking_enabled: boolean }).growth_tracking_enabled).toBe(true)
  })
})

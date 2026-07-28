/**
 * T013 (Feature 050 US1) — lookup das faixas de referência no banco.
 * Self-contained: insere as próprias faixas (a tabela não vive no
 * catalog_baseline, então o reset a esvazia — mesma escolha da 0182).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  listLabRangesForPatient,
  listSexDependentAnalytes,
} from '@/lib/core/labs/reference-ranges'
import { classifyLabResults } from '@/lib/core/labs/classify'

type RangeSeed = {
  analyte_key: string
  sex: 'M' | 'F' | 'any'
  age_min_years: number
  age_max_years: number
  state?: 'padrao' | 'gestante' | 'lactante'
  ref_min: number | null
  ref_max: number | null
  unit: string
  source_label?: string
}

async function seedRanges(rows: RangeSeed[]): Promise<void> {
  const sb = serviceClient()
  const { error } = await sb.from('lab_reference_ranges').insert(
    rows.map((r) => ({ state: 'padrao', source_label: 'teste', ...r })) as never,
  )
  if (error) throw new Error(`seed lab_reference_ranges: ${error.message}`)
}

describe('Feature 050 US1 — lookup de faixa por sexo/idade/estado', () => {
  beforeAll(async () => {
    await resetDatabase()
    await seedRanges([
      // Ferritina: diverge por sexo (caso real da fonte).
      { analyte_key: 'lab_ferritina', sex: 'M', age_min_years: 0, age_max_years: 130, ref_min: 70, ref_max: 150, unit: 'mcg/L' },
      { analyte_key: 'lab_ferritina', sex: 'F', age_min_years: 0, age_max_years: 130, ref_min: 70, ref_max: 200, unit: 'mcg/L' },
      // TSH: mesma faixa para ambos os sexos.
      { analyte_key: 'lab_tsh', sex: 'any', age_min_years: 0, age_max_years: 130, ref_min: 1, ref_max: 2.5, unit: 'mUI/L' },
      // Hemoglobina: 'any' genérico + linha específica de mulher (prova o desempate).
      { analyte_key: 'lab_hemoglobina', sex: 'any', age_min_years: 0, age_max_years: 130, ref_min: 12, ref_max: 18, unit: 'g/dL' },
      { analyte_key: 'lab_hemoglobina', sex: 'F', age_min_years: 0, age_max_years: 130, ref_min: 13.5, ref_max: 15.5, unit: 'g/dL' },
      // Vitamina D: só para adulto — prova o recorte etário.
      { analyte_key: 'lab_vitamina_d', sex: 'any', age_min_years: 18, age_max_years: 130, ref_min: 40, ref_max: 60, unit: 'ng/mL' },
      // Ácido fólico: faixa de gestante além da padrão.
      { analyte_key: 'lab_acido_folico', sex: 'F', age_min_years: 0, age_max_years: 130, ref_min: 12, ref_max: 20, unit: 'ng/mL' },
      { analyte_key: 'lab_acido_folico', sex: 'F', age_min_years: 0, age_max_years: 130, state: 'gestante', ref_min: 20, ref_max: 40, unit: 'ng/mL' },
    ])
  })

  it('escolhe a faixa do sexo informado', async () => {
    const sb = serviceClient()
    const homem = await listLabRangesForPatient(sb, { ageYears: 40, sex: 'M' })
    const mulher = await listLabRangesForPatient(sb, { ageYears: 40, sex: 'F' })
    expect(homem.get('lab_ferritina')).toMatchObject({ refMin: 70, refMax: 150 })
    expect(mulher.get('lab_ferritina')).toMatchObject({ refMin: 70, refMax: 200 })
  })

  it("usa a faixa 'any' quando não há linha específica do sexo", async () => {
    const sb = serviceClient()
    const homem = await listLabRangesForPatient(sb, { ageYears: 40, sex: 'M' })
    expect(homem.get('lab_tsh')).toMatchObject({ refMin: 1, refMax: 2.5 })
  })

  it("sexo específico vence 'any' quando as duas linhas existem", async () => {
    const sb = serviceClient()
    const mulher = await listLabRangesForPatient(sb, { ageYears: 40, sex: 'F' })
    const homem = await listLabRangesForPatient(sb, { ageYears: 40, sex: 'M' })
    expect(mulher.get('lab_hemoglobina')).toMatchObject({ refMin: 13.5, refMax: 15.5 })
    expect(homem.get('lab_hemoglobina')).toMatchObject({ refMin: 12, refMax: 18 })
  })

  it("estado informado vence 'padrao'", async () => {
    const sb = serviceClient()
    const padrao = await listLabRangesForPatient(sb, { ageYears: 30, sex: 'F' })
    const gestante = await listLabRangesForPatient(sb, { ageYears: 30, sex: 'F', state: 'gestante' })
    expect(padrao.get('lab_acido_folico')).toMatchObject({ refMin: 12, refMax: 20 })
    expect(gestante.get('lab_acido_folico')).toMatchObject({ refMin: 20, refMax: 40 })
  })

  it('idade fora de toda faixa deixa o analito sem referência', async () => {
    const sb = serviceClient()
    const crianca = await listLabRangesForPatient(sb, { ageYears: 8, sex: 'F' })
    const adulto = await listLabRangesForPatient(sb, { ageYears: 30, sex: 'F' })
    expect(crianca.has('lab_vitamina_d')).toBe(false)
    expect(adulto.get('lab_vitamina_d')).toMatchObject({ refMin: 40, refMax: 60 })
  })

  it("sem sexo, devolve só as faixas 'any' — não bloqueia o resto", async () => {
    // Caso real: 699 de 712 pacientes em produção não têm sexo cadastrado.
    const sb = serviceClient()
    const semSexo = await listLabRangesForPatient(sb, { ageYears: 40, sex: null })
    expect(semSexo.get('lab_tsh')).toMatchObject({ refMin: 1, refMax: 2.5 })
    expect(semSexo.get('lab_hemoglobina')).toMatchObject({ refMin: 12, refMax: 18 })
    // Ferritina só tem linha M e F: sem sexo, fica de fora (vira sem_referencia).
    expect(semSexo.has('lab_ferritina')).toBe(false)
  })

  it('sem idade, não filtra faixa etária e usa a banda mais abrangente', async () => {
    const sb = serviceClient()
    const semIdade = await listLabRangesForPatient(sb, { ageYears: null, sex: 'F' })
    expect(semIdade.get('lab_ferritina')).toMatchObject({ refMin: 70, refMax: 200 })
    // Vitamina D só tem faixa 18–130; sem idade ela entra (é a única banda).
    expect(semIdade.get('lab_vitamina_d')).toMatchObject({ refMin: 40, refMax: 60 })
  })

  it('sem sexo NEM idade, ainda classifica o que independe dos dois', async () => {
    const sb = serviceClient()
    const nada = await listLabRangesForPatient(sb, {})
    expect(nada.get('lab_tsh')).toMatchObject({ refMin: 1, refMax: 2.5 })
    expect(nada.has('lab_ferritina')).toBe(false)
  })

  it('listSexDependentAnalytes acha os que só têm faixa por sexo', async () => {
    const sb = serviceClient()
    const dependentes = await listSexDependentAnalytes(sb)
    expect(dependentes.has('lab_ferritina')).toBe(true) // só M e F
    expect(dependentes.has('lab_tsh')).toBe(false) // tem 'any'
    expect(dependentes.has('lab_hemoglobina')).toBe(false) // tem 'any' + F
  })

  it('carrega unidade e procedência para exibição', async () => {
    const sb = serviceClient()
    const r = await listLabRangesForPatient(sb, { ageYears: 40, sex: 'M' })
    expect(r.get('lab_ferritina')?.unit).toBe('mcg/L')
    expect(r.get('lab_ferritina')?.sourceLabel).toBe('teste')
  })

  it('ponta a ponta: a mesma ferritina classifica diferente por sexo (SC-002)', async () => {
    const sb = serviceClient()
    const result = [
      { analyteKey: 'lab_ferritina', value: 180, unit: 'mcg/L', measuredAt: '2026-07-20' },
    ]
    const homem = classifyLabResults(
      result,
      await listLabRangesForPatient(sb, { ageYears: 40, sex: 'M' }),
    )
    const mulher = classifyLabResults(
      result,
      await listLabRangesForPatient(sb, { ageYears: 40, sex: 'F' }),
    )
    expect(homem.items[0]!.class).toBe('alto')
    expect(mulher.items[0]!.class).toBe('normal')
  })
})

describe('Feature 050 — catálogo de analitos sobrevive ao reset (gotcha 0170)', () => {
  it('os exames semeados pela 0184 continuam no catálogo após resetDatabase', async () => {
    // `patient_metric_types` É truncada e restaurada do catalog_baseline. Se a
    // migration esquecer o refresh do baseline, os 80 analitos somem a cada
    // vitest e a feature "funciona" só até o primeiro teste rodar.
    await resetDatabase()
    const sb = serviceClient()
    const { data, error } = await sb
      .from('patient_metric_types')
      .select('metric_type')
      .eq('specialty', 'laboratorio')
    if (error) throw new Error(error.message)
    expect((data ?? []).length).toBeGreaterThan(50)
  })
})

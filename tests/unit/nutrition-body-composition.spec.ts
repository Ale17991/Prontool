/**
 * T017 (Feature 046) — composição corporal (dobras → %gordura) vs. gabarito.
 * Fórmulas de nutri-doc/formulas-referencia.md. Caso base: M, 30 anos, 80 kg, 180 cm.
 */
import { describe, it, expect } from 'vitest'
import {
  computeComposition,
  siri,
  NutritionInputError,
  type CompositionInput,
} from '@/lib/core/nutrition/body-composition'

const base: Omit<CompositionInput, 'protocol'> = {
  sex: 'M',
  ageYears: 30,
  weightKg: 80,
  heightCm: 180,
}

describe('Feature 046 — Siri', () => {
  it('Dc → %gordura', () => {
    // 495/1.05 − 450 = 21.4285…
    expect(siri(1.05)).toBeCloseTo(21.4286, 3)
  })
})

describe('Feature 046 — protocolos de composição', () => {
  it('Jackson-Pollock 3 dobras (M): densidade + Siri', () => {
    const r = computeComposition({
      ...base,
      protocol: 'jp3',
      skinfolds: { peitoral: 12, abdominal: 20, coxa: 15 }, // Σ=47
    })
    // Dc = 1.10938 − 0.0008267·47 + 0.0000016·47² − 0.0002574·30 ≈ 1.066338
    expect(r.bodyDensity).toBeCloseTo(1.06634, 4)
    expect(r.fatPct).toBeCloseTo(14.21, 1)
    // invariante: massa gorda + massa magra = peso
    expect(r.fatMassKg + r.leanMassKg).toBeCloseTo(80, 2)
    expect(r.fatMassKg).toBeCloseTo(11.37, 1)
  })

  it('Faulkner (M): %gordura direto (sem densidade)', () => {
    const r = computeComposition({
      ...base,
      protocol: 'faulkner',
      skinfolds: { triceps: 10, subescapular: 12, abdominal: 20, suprailiaca: 15 }, // Σ=57
    })
    expect(r.bodyDensity).toBeNull()
    expect(r.fatPct).toBeCloseTo(57 * 0.153 + 5.783, 2) // 14.504
  })

  it('bioimpedância: %gordura direto do aparelho', () => {
    const r = computeComposition({ ...base, protocol: 'bioimpedancia', fatPctInput: 18.5 })
    expect(r.fatPct).toBe(18.5)
    expect(r.bodyDensity).toBeNull()
  })

  it('IMC e RCQ com classificação', () => {
    const r = computeComposition({
      ...base,
      protocol: 'jp3',
      skinfolds: { peitoral: 12, abdominal: 20, coxa: 15 },
      circumferences: { cintura: 88, quadril: 100 },
    })
    expect(r.imc).toBeCloseTo(24.69, 1) // 80/1.8²
    expect(r.imcClass).toBe('Eutrofia')
    expect(r.waistHipRatio).toBe(0.88)
    expect(r.waistHipClass).toBe('Risco moderado') // M 30-39
  })

  it('dobras faltando → MISSING_SKINFOLDS', () => {
    expect(() =>
      computeComposition({ ...base, protocol: 'jp3', skinfolds: { peitoral: 12 } }),
    ).toThrow(NutritionInputError)
  })
})

/**
 * T016 (Feature 049 US2) — motor de adequação (classificação por faixa).
 */
import { describe, it, expect } from 'vitest'
import { computeAdequacy } from '@/lib/core/nutrition/adequacy'
import type { Nutrients } from '@/lib/core/nutrition/diet/totals'
import type { DriValue } from '@/lib/core/nutrition/dri/read'

describe('computeAdequacy — abaixo/adequado/acima', () => {
  const totals: Nutrients = {
    energyKcal: 0,
    proteinG: 0,
    carbG: 0,
    fatG: 0,
    fiberG: 20,
    micros: { ferro_mg: 8, calcio_mg: 500 },
  }
  const dris = new Map<string, DriValue>([
    ['ferro', { value: 8, unit: 'mg' }], // 100% → adequado
    ['calcio', { value: 1000, unit: 'mg' }], // 50% → abaixo
    ['fibra', { value: 10, unit: 'g' }], // 200% → acima
    ['zinco', { value: 11, unit: 'mg' }], // consumido 0 → abaixo
  ])

  it('classifica cada nutriente e conta carências/excessos', () => {
    const r = computeAdequacy(totals, dris)
    const byKey = new Map(r.items.map((i) => [i.nutrientKey, i]))
    expect(byKey.get('ferro')!.pct).toBe(100)
    expect(byKey.get('ferro')!.class).toBe('adequado')
    expect(byKey.get('calcio')!.class).toBe('abaixo')
    expect(byKey.get('fibra')!.class).toBe('acima')
    expect(byKey.get('zinco')!.total).toBe(0)
    expect(byKey.get('zinco')!.class).toBe('abaixo')
    expect(r.deficits).toBe(2) // calcio + zinco
    expect(r.excesses).toBe(1) // fibra
  })
})

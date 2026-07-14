/**
 * T041 (Feature 045) — testes de unidade puros (sem DB).
 *
 * - Derivação `costPending`/`totalCostCents` em `mapAppointmentMaterialRow`.
 * - Fronteira de mês no fuso do tenant (`ymdStartOfDayUtc`/`ymdNextDayStartUtc`)
 *   — a janela que `computeOperatingResult`/`sumMaterialsCost` usam.
 */
import { describe, it, expect } from 'vitest'
import { mapAppointmentMaterialRow } from '@/lib/core/appointments/materials/list'
import { ymdStartOfDayUtc, ymdNextDayStartUtc } from '@/lib/utils/tenant-tz'

describe('Feature 045 — mapAppointmentMaterialRow (derivações)', () => {
  it('custo 0 → costPending true e total 0', () => {
    const m = mapAppointmentMaterialRow({
      id: 'r1',
      tuss_code: null,
      tuss_description: null,
      material_id: null,
      material_name: 'Gaze',
      quantity: 3,
      unit_cost_cents: 0,
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'u1',
    })
    expect(m.costPending).toBe(true)
    expect(m.totalCostCents).toBe(0)
    expect(m.name).toBe('Gaze')
  })

  it('custo > 0 → costPending false e total = unit × quantity', () => {
    const m = mapAppointmentMaterialRow({
      id: 'r2',
      tuss_code: null,
      tuss_description: null,
      material_id: 'mat-1',
      material_name: 'Resina',
      quantity: 4,
      unit_cost_cents: 1200,
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'u1',
    })
    expect(m.costPending).toBe(false)
    expect(m.totalCostCents).toBe(4800)
    expect(m.materialId).toBe('mat-1')
  })

  it('nome cai para tuss_description → tuss_code → "—"', () => {
    expect(
      mapAppointmentMaterialRow({
        id: 'r3',
        tuss_code: '90000001',
        tuss_description: 'Compressa',
        material_id: null,
        material_name: null,
        quantity: 1,
        unit_cost_cents: 100,
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'u1',
      }).name,
    ).toBe('Compressa')
    expect(
      mapAppointmentMaterialRow({
        id: 'r4',
        tuss_code: '90000002',
        tuss_description: null,
        material_id: null,
        material_name: null,
        quantity: 1,
        unit_cost_cents: 100,
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'u1',
      }).name,
    ).toBe('90000002')
  })
})

describe('Feature 045 — fronteira de mês no fuso do tenant', () => {
  const TZ = 'America/Sao_Paulo' // UTC-3

  it('início do mês em BRT → meia-noite deslocada para 03:00Z', () => {
    expect(ymdStartOfDayUtc('2026-01-01', TZ)).toBe('2026-01-01T03:00:00.000Z')
  })

  it('bound superior exclusivo = 1º dia do mês seguinte em BRT', () => {
    // Janela de janeiro: [01/01 00:00 BRT, 01/02 00:00 BRT).
    expect(ymdNextDayStartUtc('2026-01-31', TZ)).toBe('2026-02-01T03:00:00.000Z')
  })

  it('em UTC a meia-noite local coincide com 00:00Z', () => {
    expect(ymdStartOfDayUtc('2026-01-01', 'UTC')).toBe('2026-01-01T00:00:00.000Z')
  })
})

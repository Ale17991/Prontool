/**
 * Unit tests for src/lib/core/reports/doctor-plan-matrix.ts — pure
 * aggregation, no DB. Cobre: multi-procedimento com planos distintos no mesmo
 * atendimento, médico a 0% de comissão, particular (sem plano), imposto do
 * convênio por célula e os rollups por médico / por plano.
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateDoctorPlanMatrix,
  PARTICULAR_PLAN_ID,
} from '@/lib/core/reports/doctor-plan-matrix'

type Appt = Parameters<typeof aggregateDoctorPlanMatrix>[0]['appointments'][number]
type Line = Parameters<typeof aggregateDoctorPlanMatrix>[0]['lines'][number]

function appt(over: Partial<Appt> & Pick<Appt, 'id' | 'doctor_id'>): Appt {
  return {
    patient_id: 'p1',
    appointment_at: '2026-06-01T12:00:00Z',
    effective_status: 'ativo',
    frozen_commission_bps: 0,
    ...over,
  }
}

function line(over: Partial<Line> & Pick<Line, 'appointment_id' | 'line_amount_cents'>): Line {
  return {
    procedure_id: 'proc1',
    plan_id: null,
    quantity: 1,
    procedures: null,
    health_plans: null,
    ...over,
  }
}

const doctorNames = new Map([
  ['d1', 'Dra. Ana'],
  ['d2', 'Dr. Bruno'],
])

describe('aggregateDoctorPlanMatrix', () => {
  it('separa o mesmo atendimento em células por plano (multi-procedimento)', () => {
    const appointments = [appt({ id: 'a1', doctor_id: 'd1', frozen_commission_bps: 2000 })]
    const lines = [
      line({
        appointment_id: 'a1',
        line_amount_cents: 10000,
        plan_id: 'plan-unimed',
        health_plans: { id: 'plan-unimed', name: 'Unimed' },
      }),
      line({
        appointment_id: 'a1',
        line_amount_cents: 5000,
        plan_id: 'plan-bradesco',
        health_plans: { id: 'plan-bradesco', name: 'Bradesco' },
      }),
    ]

    const m = aggregateDoctorPlanMatrix({
      appointments,
      lines,
      doctorNameById: doctorNames,
      planTaxMap: new Map(),
    })

    expect(m.cells).toHaveLength(2)
    const unimed = m.cells.find((c) => c.planId === 'plan-unimed')!
    const bradesco = m.cells.find((c) => c.planId === 'plan-bradesco')!
    expect(unimed.grossCents).toBe(10000)
    expect(unimed.commissionCents).toBe(2000) // 20%
    expect(bradesco.grossCents).toBe(5000)
    expect(bradesco.commissionCents).toBe(1000)
    // Um único médico, dois planos → rollup por médico soma os dois.
    expect(m.byDoctor).toHaveLength(1)
    expect(m.byDoctor[0]!.grossCents).toBe(15000)
    expect(m.byDoctor[0]!.byPlan).toHaveLength(2)
    expect(m.totals.grossCents).toBe(15000)
    expect(m.totals.commissionCents).toBe(3000)
  })

  it('médico a 0% de comissão gera receita mas comissão zero', () => {
    const m = aggregateDoctorPlanMatrix({
      appointments: [appt({ id: 'a1', doctor_id: 'd1', frozen_commission_bps: 0 })],
      lines: [line({ appointment_id: 'a1', line_amount_cents: 30000, plan_id: null })],
      doctorNameById: doctorNames,
      planTaxMap: new Map(),
    })
    expect(m.cells).toHaveLength(1)
    expect(m.cells[0]!.grossCents).toBe(30000)
    expect(m.cells[0]!.commissionCents).toBe(0)
    expect(m.cells[0]!.planId).toBe(PARTICULAR_PLAN_ID)
    expect(m.cells[0]!.planName).toBe('Particular')
  })

  it('aplica imposto do convênio por célula sobre o bruto', () => {
    const m = aggregateDoctorPlanMatrix({
      appointments: [appt({ id: 'a1', doctor_id: 'd1', frozen_commission_bps: 1000 })],
      lines: [
        line({
          appointment_id: 'a1',
          line_amount_cents: 20000,
          plan_id: 'plan-x',
          health_plans: { id: 'plan-x', name: 'Plano X' },
        }),
      ],
      doctorNameById: doctorNames,
      planTaxMap: new Map([['plan-x', 500]]), // 5%
    })
    const cell = m.cells[0]!
    expect(cell.taxRateBps).toBe(500)
    expect(cell.taxFromPlanCents).toBe(1000) // 5% de 20000
    expect(cell.netOfTaxCents).toBe(19000)
  })

  it('respeita quantity no total da linha e na comissão', () => {
    const m = aggregateDoctorPlanMatrix({
      appointments: [appt({ id: 'a1', doctor_id: 'd1', frozen_commission_bps: 1000 })],
      lines: [line({ appointment_id: 'a1', line_amount_cents: 10000, quantity: 3 })],
      doctorNameById: doctorNames,
      planTaxMap: new Map(),
    })
    expect(m.cells[0]!.grossCents).toBe(30000)
    expect(m.cells[0]!.commissionCents).toBe(3000)
    expect(m.cells[0]!.procedureCount).toBe(3)
  })

  it('ignora linhas de atendimento fora do conjunto ativo', () => {
    const m = aggregateDoctorPlanMatrix({
      appointments: [appt({ id: 'a1', doctor_id: 'd1' })],
      lines: [line({ appointment_id: 'a-estornado', line_amount_cents: 99999 })],
      doctorNameById: doctorNames,
      planTaxMap: new Map(),
    })
    expect(m.cells).toHaveLength(0)
    expect(m.totals.grossCents).toBe(0)
  })

  it('rollupByPlan agrega dois médicos no mesmo plano', () => {
    const m = aggregateDoctorPlanMatrix({
      appointments: [
        appt({ id: 'a1', doctor_id: 'd1', frozen_commission_bps: 1000 }),
        appt({ id: 'a2', doctor_id: 'd2', frozen_commission_bps: 2000 }),
      ],
      lines: [
        line({
          appointment_id: 'a1',
          line_amount_cents: 10000,
          plan_id: 'plan-x',
          health_plans: { id: 'plan-x', name: 'Plano X' },
        }),
        line({
          appointment_id: 'a2',
          line_amount_cents: 20000,
          plan_id: 'plan-x',
          health_plans: { id: 'plan-x', name: 'Plano X' },
        }),
      ],
      doctorNameById: doctorNames,
      planTaxMap: new Map(),
    })
    expect(m.byPlan).toHaveLength(1)
    expect(m.byPlan[0]!.grossCents).toBe(30000)
    expect(m.byPlan[0]!.commissionCents).toBe(5000) // 1000 + 4000
    expect(m.byDoctor).toHaveLength(2)
  })

  it('rotula médico ausente do catálogo como inativo', () => {
    const m = aggregateDoctorPlanMatrix({
      appointments: [appt({ id: 'a1', doctor_id: 'fantasma' })],
      lines: [line({ appointment_id: 'a1', line_amount_cents: 1000 })],
      doctorNameById: doctorNames,
      planTaxMap: new Map(),
    })
    expect(m.cells[0]!.doctorName).toBe('Profissional inativo')
  })
})

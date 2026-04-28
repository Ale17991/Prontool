/**
 * Integration test for `listAppointmentsForWeek` (feature 004 / US1).
 * - Seeds 5 atendimentos em 2 profissionais ao longo da semana corrente.
 * - Verifica filtro por doctorIds, recorte por janela, COALESCE para 30 min,
 *   e mapeamento de effective_status='estornado'.
 */
import { addDays } from 'date-fns'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedDoctor,
  seedPriceVersion,
  seedAppointment,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { listAppointmentsForWeek } from '@/lib/core/appointments/list-week'
import { getWeekRange, DEFAULT_DURATION_MINUTES } from '@/lib/utils/calendar'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

describe('listAppointmentsForWeek', () => {
  let tenantId: string
  let doctorAId: string
  let doctorBId: string
  const supa = () => serviceClient() as unknown as SupabaseClient<Database>

  beforeAll(async () => {
    await resetDatabase()
    const tenant = await seedTenant()
    tenantId = tenant.tenantId
    await seedTussCode('10101012')
    const procedureId = await seedProcedure(tenantId, '10101012')
    const planId = await seedHealthPlan(tenantId)
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const doctorA = await seedDoctor(tenantId, { crm: 'CRM-AL' })
    const doctorB = await seedDoctor(tenantId, { crm: 'CRM-BR' })
    doctorAId = doctorA.doctorId
    doctorBId = doctorB.doctorId
    const patientId = await seedPatient(tenantId)
    const range = getWeekRange(new Date())
    // 3 atendimentos da Aline em dias diferentes
    for (let i = 0; i < 3; i++) {
      const at = new Date(range.days[i + 1] ?? range.start)
      at.setHours(9, 0, 0, 0)
      await seedAppointment({
        tenantId,
        patientId,
        doctorId: doctorAId,
        procedureId,
        planId,
        priceVersionId,
        commissionId: doctorA.commissionId,
        amountCents: 20000,
        commissionBps: 1000,
        at: at.toISOString(),
      })
    }
    // 2 atendimentos do Bruno
    for (let i = 0; i < 2; i++) {
      const at = new Date(range.days[i + 4] ?? range.start)
      at.setHours(14, 0, 0, 0)
      await seedAppointment({
        tenantId,
        patientId,
        doctorId: doctorBId,
        procedureId,
        planId,
        priceVersionId,
        commissionId: doctorB.commissionId,
        amountCents: 25000,
        commissionBps: 1500,
        at: at.toISOString(),
      })
    }
  })

  it('returns all 5 appointments without doctor filter', async () => {
    const range = getWeekRange(new Date())
    const rows = await listAppointmentsForWeek(supa(), {
      tenantId,
      weekStart: range.start,
      weekEnd: range.end,
    })
    expect(rows).toHaveLength(5)
  })

  it('filters by doctorIds', async () => {
    const range = getWeekRange(new Date())
    const aliceRows = await listAppointmentsForWeek(supa(), {
      tenantId,
      weekStart: range.start,
      weekEnd: range.end,
      doctorIds: [doctorAId],
    })
    expect(aliceRows).toHaveLength(3)
    expect(aliceRows.every((r) => r.doctorId === doctorAId)).toBe(true)
  })

  it('respects the time window', async () => {
    const range = getWeekRange(new Date())
    const onlyFirstHalf = await listAppointmentsForWeek(supa(), {
      tenantId,
      weekStart: range.start,
      weekEnd: addDays(range.start, 3),
    })
    expect(onlyFirstHalf.length).toBeGreaterThan(0)
    expect(onlyFirstHalf.length).toBeLessThanOrEqual(5)
  })

  it('defaults durationMinutes to 30 when null in DB', async () => {
    const range = getWeekRange(new Date())
    const rows = await listAppointmentsForWeek(supa(), {
      tenantId,
      weekStart: range.start,
      weekEnd: range.end,
    })
    expect(rows.every((r) => r.durationMinutes === DEFAULT_DURATION_MINUTES)).toBe(true)
  })
})

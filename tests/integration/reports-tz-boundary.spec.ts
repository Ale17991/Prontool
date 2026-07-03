/**
 * Camada 3 T1 — testes de boundary do fuso do tenant em relatórios.
 *
 * Reproduz o bug concreto descrito no report da Camada 3:
 *   Clínica em São Paulo (UTC-3). Agendamento Jan 31 às 22:30 BRT
 *   (= Feb 01 01:30 UTC). User gera relatório de Janeiro.
 *
 * Antes da migração (PoC + 4 arquivos): o appointment NÃO aparecia em
 * Janeiro porque o cap do range era `2026-02-01T00:00:00Z` (< 01:30 UTC).
 * Aparecia no relatório de Fevereiro — semanas depois, dificultando o
 * débito mental do user.
 *
 * Depois da migração: cap = `2026-02-01T03:00:00.000Z` (= 00:00 BRT do
 * dia 01/02). O appointment de 01:30 UTC está dentro → relatório
 * captura o que o user marcou na agenda no dia 31.
 *
 * Espelho: appointment Dec 31 às 22:30 BRT (= Jan 01 01:30 UTC) **NÃO**
 * deve aparecer no relatório de Janeiro 2026 — antes da migração APARECIA
 * (lower bound era UTC midnight do dia 01/01).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedDoctor,
  seedPatient,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { buildMonthlyReport } from '@/lib/core/reports/monthly'

describe('reports: TZ boundary em São Paulo (Camada 3 T1)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('appointment 22:30 BRT do último dia do mês entra no relatório do mês', async () => {
    const { tenantId } = await seedTenant('tz-boundary-jan-last')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const patientId = await seedPatient(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('TZTEST01', { tussTable: '22' })
    const procedureId = await seedProcedure(tenantId, 'TZTEST01')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })

    // 22:30 BRT do 31/01/2026 = 01:30 UTC do 01/02/2026
    await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 10000,
      commissionBps: 4000,
      completed: true,
      at: '2026-02-01T01:30:00.000Z',
    })

    const report = await buildMonthlyReport(serviceClient() as never, {
      tenantId,
      from: '2026-01-01',
      to: '2026-01-31',
    })

    // Antes do fix: appointmentCount=0 (boundary UTC excluia 01:30Z).
    // Depois do fix: appointmentCount=1 (boundary BRT estende até 03:00Z).
    expect(report.totals.appointmentCount).toBe(1)
    expect(report.totals.netRevenueCents).toBe(10000)
  })

  it('appointment 22:30 BRT do dia anterior ao período NÃO entra no relatório', async () => {
    const { tenantId } = await seedTenant('tz-boundary-dec-prev')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const patientId = await seedPatient(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('TZTEST02', { tussTable: '22' })
    const procedureId = await seedProcedure(tenantId, 'TZTEST02')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 5000,
      validFrom: '2020-01-01',
    })

    // 22:30 BRT do 31/12/2025 = 01:30 UTC do 01/01/2026 — instante físico
    // ANTES do início de Janeiro 2026 no fuso do tenant (00:00 BRT do 01/01).
    await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 5000,
      commissionBps: 4000,
      completed: true,
      at: '2026-01-01T01:30:00.000Z',
    })

    const report = await buildMonthlyReport(serviceClient() as never, {
      tenantId,
      from: '2026-01-01',
      to: '2026-01-31',
    })

    // Antes do fix: appointmentCount=1 (boundary UTC inclui 01:30Z).
    // Depois do fix: appointmentCount=0 (boundary BRT começa em 03:00Z).
    expect(report.totals.appointmentCount).toBe(0)
  })

  it('appointment dentro do horário comercial (14:00 BRT) cai no mês esperado', async () => {
    // Sanity check — apontamento "normal" deve continuar funcionando após
    // o fix. 14:00 BRT do 15/01 = 17:00 UTC, claramente em Janeiro.
    const { tenantId } = await seedTenant('tz-boundary-normal')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const patientId = await seedPatient(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('TZTEST03', { tussTable: '22' })
    const procedureId = await seedProcedure(tenantId, 'TZTEST03')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })

    await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 20000,
      commissionBps: 4000,
      completed: true,
      at: '2026-01-15T17:00:00.000Z', // 14:00 BRT do 15/01
    })

    const report = await buildMonthlyReport(serviceClient() as never, {
      tenantId,
      from: '2026-01-01',
      to: '2026-01-31',
    })

    expect(report.totals.appointmentCount).toBe(1)
    expect(report.totals.netRevenueCents).toBe(20000)
  })
})

/**
 * T134 — Export parity (SC-006). The three output channels (JSON, PDF,
 * Excel) must reflect the same numbers.
 *
 * We read the Excel back with ExcelJS and assert every totals and
 * per-plan/per-doctor number matches the JSON DTO byte-for-byte.
 *
 * For the PDF, we can't cheaply parse `@react-pdf/renderer`'s FlateDecoded
 * content streams here, so parity is covered by construction: both
 * `renderMonthlyReportPdf` and `renderMonthlyReportExcel` consume the
 * same `MonthlyReport` DTO that `monthlyReportToWire()` serializes for
 * the HTTP response (see src/lib/core/reports/monthly.ts — no branch
 * between them). We still assert the rendered PDF is a valid %PDF-
 * document with non-trivial size so a broken renderer wouldn't silently
 * ship empty bytes.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { buildMonthlyReport, monthlyReportToWire } from '@/lib/core/reports/monthly'
import { renderMonthlyReportExcel } from '@/lib/core/reports/export-excel'
import { renderMonthlyReportPdf } from '@/lib/core/reports/export-pdf'

const TUSS = '10101012'

describe('T134 — export parity JSON ↔ Excel ↔ PDF', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('Excel cells match the JSON DTO and PDF is a non-empty %PDF- document', async () => {
    const { tenantId } = await seedTenant('t134')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Parity Plan')
    const { doctorId, commissionId } = await seedDoctor(tenantId, {
      crm: 'DOC-PARITY',
      bps: 4000,
    })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 123_400,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId,
      amountCents: 123_400,
      commissionBps: 4000,
      at: '2026-05-07T10:00:00Z',
    })
    await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId,
      amountCents: 123_400,
      commissionBps: 4000,
      at: '2026-05-17T10:00:00Z',
    })

    const sb = serviceClient()
    const report = await buildMonthlyReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    const wire = monthlyReportToWire(report)

    // JSON sanity: totals are what we expect.
    expect(wire.totals.net_revenue_cents).toBe(246_800)
    expect(wire.totals.net_commission_cents).toBe(98_720)

    // --- Excel parity ------------------------------------------------------
    const xlsx = await renderMonthlyReportExcel(report, { tenantLabel: 'tenant-parity' })
    const wb = new ExcelJS.Workbook()
    // exceljs' d.ts predates the newer Buffer<ArrayBufferLike> generic;
    // at runtime it accepts any Node Buffer / ArrayBuffer unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(xlsx as any)

    const revenueSheet = wb.getWorksheet('Receita por Plano')!
    // Row 1 is the header; rows 2..n carry plan data.
    const revenueRows: Array<{ plan: string; revenueCents: number; count: number }> = []
    revenueSheet.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      revenueRows.push({
        plan: String(row.getCell(1).value ?? ''),
        revenueCents: Math.round(Number(row.getCell(2).value ?? 0) * 100),
        count: Number(row.getCell(3).value ?? 0),
      })
    })
    expect(revenueRows).toHaveLength(wire.revenue_by_plan.length)
    for (const jsonRow of wire.revenue_by_plan) {
      const xlsxRow = revenueRows.find((r) => r.plan === jsonRow.plan_name)
      expect(xlsxRow).toBeDefined()
      expect(xlsxRow!.revenueCents).toBe(jsonRow.net_revenue_cents)
      expect(xlsxRow!.count).toBe(jsonRow.appointment_count)
    }

    const prodSheet = wb.getWorksheet('Produção por Profissional')!
    const prodRows: Array<{
      name: string
      productionCents: number
      commissionCents: number
      count: number
    }> = []
    prodSheet.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      prodRows.push({
        name: String(row.getCell(1).value ?? ''),
        productionCents: Math.round(Number(row.getCell(2).value ?? 0) * 100),
        commissionCents: Math.round(Number(row.getCell(3).value ?? 0) * 100),
        count: Number(row.getCell(4).value ?? 0),
      })
    })
    expect(prodRows).toHaveLength(wire.production_by_doctor.length)
    for (const jsonRow of wire.production_by_doctor) {
      const xlsxRow = prodRows.find((r) => r.name === jsonRow.doctor_name)
      expect(xlsxRow).toBeDefined()
      expect(xlsxRow!.productionCents).toBe(jsonRow.net_production_cents)
      expect(xlsxRow!.commissionCents).toBe(jsonRow.net_commission_cents)
      expect(xlsxRow!.count).toBe(jsonRow.appointment_count)
    }

    // Totals sheet: find rows by their metric label.
    const totalsSheet = wb.getWorksheet('Totais')!
    const totalsMap = new Map<string, unknown>()
    totalsSheet.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      const metric = row.getCell(1).value
      const value = row.getCell(2).value
      if (metric !== null && metric !== undefined && metric !== '') {
        totalsMap.set(String(metric), value)
      }
    })
    expect(Math.round(Number(totalsMap.get('Receita líquida total') ?? 0) * 100)).toBe(
      wire.totals.net_revenue_cents,
    )
    expect(Math.round(Number(totalsMap.get('Comissão líquida total') ?? 0) * 100)).toBe(
      wire.totals.net_commission_cents,
    )
    expect(Number(totalsMap.get('Atendimentos'))).toBe(wire.totals.appointment_count)
    expect(Number(totalsMap.get('Cancelamentos'))).toBe(wire.totals.reversal_count)

    // --- PDF smoke check ---------------------------------------------------
    const pdfBuf = await renderMonthlyReportPdf(report, { tenantLabel: 'tenant-parity' })
    expect(pdfBuf.length).toBeGreaterThan(1000)
    expect(pdfBuf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})

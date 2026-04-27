import ExcelJS from 'exceljs'
import type { MonthlyReport } from './monthly'

/**
 * T141 — Exporta MonthlyReport em XLSX com 3 abas:
 *   1. "Receita por Plano" — plano, receita líquida (BRL), atendimentos
 *   2. "Produção por Médico" — nome, produção líquida, comissão líquida,
 *                               atendimentos
 *   3. "Totais"             — cabeçalho com período, totais consolidados
 *
 * Valores monetários gravados em reais (centavos/100) com formatação
 * R$ nativa do Excel. Mesmos números do JSON/PDF (SC-006).
 */
export async function renderMonthlyReportExcel(
  report: MonthlyReport,
  opts: { tenantLabel?: string } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Pronttu'
  wb.created = new Date()

  const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

  // ------------------------------------------------------ Receita por plano
  const revenue = wb.addWorksheet('Receita por Plano')
  revenue.columns = [
    { header: 'Plano', key: 'plan', width: 32 },
    { header: 'Receita líquida (BRL)', key: 'revenue', width: 24, style: { numFmt: BRL } },
    { header: 'Atendimentos', key: 'count', width: 16 },
  ]
  revenue.getRow(1).font = { bold: true }
  for (const row of report.revenueByPlan) {
    revenue.addRow({
      plan: row.planName,
      revenue: row.netRevenueCents / 100,
      count: row.appointmentCount,
    })
  }

  // ---------------------------------------------------- Produção por médico
  const prod = wb.addWorksheet('Produção por Profissional')
  prod.columns = [
    { header: 'Profissional', key: 'name', width: 32 },
    { header: 'Produção líquida (BRL)', key: 'production', width: 24, style: { numFmt: BRL } },
    { header: 'Comissão líquida (BRL)', key: 'commission', width: 24, style: { numFmt: BRL } },
    { header: 'Atendimentos', key: 'count', width: 16 },
  ]
  prod.getRow(1).font = { bold: true }
  for (const row of report.productionByDoctor) {
    prod.addRow({
      name: row.doctorName,
      production: row.netProductionCents / 100,
      commission: row.netCommissionCents / 100,
      count: row.appointmentCount,
    })
  }

  // ----------------------------------------------------------------- Totais
  const totals = wb.addWorksheet('Totais')
  totals.columns = [
    { header: 'Métrica', key: 'metric', width: 32 },
    { header: 'Valor', key: 'value', width: 24 },
  ]
  totals.getRow(1).font = { bold: true }

  if (opts.tenantLabel) totals.addRow({ metric: 'Tenant', value: opts.tenantLabel })
  const addDate = (label: string, ymd: string) => {
    const row = totals.addRow({ metric: label, value: new Date(`${ymd}T12:00:00Z`) })
    row.getCell('value').numFmt = 'dd/mm/yyyy'
  }
  addDate('Período de', report.period.from)
  addDate('Período até', report.period.to)
  totals.addRow({})

  const addMoney = (label: string, cents: number) => {
    const row = totals.addRow({ metric: label, value: cents / 100 })
    row.getCell('value').numFmt = BRL
  }
  addMoney('Receita líquida total', report.totals.netRevenueCents)
  addMoney('Comissão líquida total', report.totals.netCommissionCents)
  totals.addRow({ metric: 'Atendimentos', value: report.totals.appointmentCount })
  totals.addRow({ metric: 'Estornos', value: report.totals.reversalCount })

  const arr = await wb.xlsx.writeBuffer()
  return Buffer.from(arr)
}

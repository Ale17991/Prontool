import ExcelJS from 'exceljs'
import type { FinancialReport } from './financial-report'

const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'
const PCT = '0.0%;[Red]-0.0%'

const CATEGORY_LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  equipamentos: 'Equipamentos',
  materiais: 'Materiais',
  pessoal: 'Pessoal',
  servicos: 'Serviços',
  outros: 'Outros',
}

export async function renderFinancialReportExcel(
  report: FinancialReport,
  opts: { tenantLabel?: string } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Pronttu'
  wb.created = new Date()

  // ----- Resumo
  const summary = wb.addWorksheet('Resumo')
  summary.columns = [
    { header: 'Métrica', key: 'metric', width: 36 },
    { header: 'Valor', key: 'value', width: 22 },
  ]
  summary.getRow(1).font = { bold: true }
  if (opts.tenantLabel) summary.addRow({ metric: 'Tenant', value: opts.tenantLabel })
  summary.addRow({ metric: 'Período de', value: report.period.from })
  summary.addRow({ metric: 'Período até', value: report.period.to })
  summary.addRow({ metric: 'Período anterior de', value: report.previousPeriod.from })
  summary.addRow({ metric: 'Período anterior até', value: report.previousPeriod.to })
  summary.addRow({})
  const moneyRow = (label: string, cents: number) => {
    const r = summary.addRow({ metric: label, value: cents / 100 })
    r.getCell('value').numFmt = BRL
  }
  moneyRow('Faturamento bruto', report.totals.grossRevenueCents)
  moneyRow('Comissões pagas', report.totals.commissionsCents)
  moneyRow('Receita líquida', report.totals.netRevenueCents)
  moneyRow('Total despesas', report.totals.totalExpensesCents)
  moneyRow('Lucro operacional', report.totals.operatingProfitCents)
  const margin = summary.addRow({
    metric: 'Margem operacional',
    value: report.totals.operatingMarginPct / 100,
  })
  margin.getCell('value').numFmt = PCT
  summary.addRow({ metric: 'Atendimentos', value: report.totals.appointmentCount })

  // ----- Receita por plano
  const plans = wb.addWorksheet('Receita por plano')
  plans.columns = [
    { header: 'Convênio', key: 'plan', width: 32 },
    { header: 'Atendimentos', key: 'count', width: 16 },
    { header: 'Total bruto', key: 'gross', width: 22, style: { numFmt: BRL } },
    { header: 'Market share', key: 'share', width: 16, style: { numFmt: PCT } },
  ]
  plans.getRow(1).font = { bold: true }
  for (const row of report.revenueByPlan) {
    plans.addRow({
      plan: row.planName,
      count: row.appointmentCount,
      gross: row.grossRevenueCents / 100,
      share: row.marketSharePct / 100,
    })
  }

  // ----- Top profissionais
  const docs = wb.addWorksheet('Top profissionais')
  docs.columns = [
    { header: 'Profissional', key: 'name', width: 32 },
    { header: 'Atendimentos', key: 'count', width: 16 },
    { header: 'Faturamento bruto', key: 'gross', width: 24, style: { numFmt: BRL } },
  ]
  docs.getRow(1).font = { bold: true }
  for (const row of report.topDoctors) {
    docs.addRow({
      name: row.doctorName,
      count: row.appointmentCount,
      gross: row.grossRevenueCents / 100,
    })
  }

  // ----- Ranking procedimentos
  const procs = wb.addWorksheet('Ranking procedimentos')
  procs.columns = [
    { header: 'Procedimento', key: 'name', width: 36 },
    { header: 'TUSS', key: 'tuss', width: 14 },
    { header: 'Quantidade', key: 'count', width: 14 },
    { header: 'Total', key: 'total', width: 22, style: { numFmt: BRL } },
  ]
  procs.getRow(1).font = { bold: true }
  for (const row of report.topProcedures) {
    procs.addRow({
      name: row.procedureName,
      tuss: row.tussCode,
      count: row.count,
      total: row.totalCents / 100,
    })
  }

  // ----- Despesas por categoria
  const exp = wb.addWorksheet('Despesas')
  exp.columns = [
    { header: 'Categoria', key: 'cat', width: 22 },
    { header: 'Quantidade', key: 'count', width: 14 },
    { header: 'Total', key: 'total', width: 22, style: { numFmt: BRL } },
    { header: '% do total', key: 'pct', width: 14, style: { numFmt: PCT } },
  ]
  exp.getRow(1).font = { bold: true }
  for (const row of report.expensesByCategory) {
    exp.addRow({
      cat: CATEGORY_LABEL[row.category] ?? row.category,
      count: row.count,
      total: row.totalCents / 100,
      pct: row.pct / 100,
    })
  }

  // ----- Comparativo
  const cmp = wb.addWorksheet('Comparativo')
  cmp.columns = [
    { header: 'Métrica', key: 'metric', width: 26 },
    { header: 'Atual', key: 'current', width: 22, style: { numFmt: BRL } },
    { header: 'Anterior', key: 'previous', width: 22, style: { numFmt: BRL } },
    { header: 'Variação', key: 'pct', width: 14, style: { numFmt: PCT } },
  ]
  cmp.getRow(1).font = { bold: true }
  cmp.addRow({
    metric: 'Faturamento bruto',
    current: report.totals.grossRevenueCents / 100,
    previous: report.previous.grossRevenueCents / 100,
    pct: report.comparison.revenuePct === null ? '' : report.comparison.revenuePct / 100,
  })
  cmp.addRow({
    metric: 'Total despesas',
    current: report.totals.totalExpensesCents / 100,
    previous: report.previous.totalExpensesCents / 100,
    pct:
      report.comparison.expensesPct === null ? '' : report.comparison.expensesPct / 100,
  })
  cmp.addRow({
    metric: 'Lucro operacional',
    current: report.totals.operatingProfitCents / 100,
    previous: report.previous.operatingProfitCents / 100,
    pct: report.comparison.profitPct === null ? '' : report.comparison.profitPct / 100,
  })

  const arr = await wb.xlsx.writeBuffer()
  return Buffer.from(arr)
}

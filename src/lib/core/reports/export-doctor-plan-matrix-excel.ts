import ExcelJS from 'exceljs'
import type { DoctorPlanMatrix } from './doctor-plan-matrix'

const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

/**
 * Exporta a matriz médico × plano em três abas:
 *   - "Matriz" — grade com médicos nas linhas e planos nas colunas (bruto).
 *   - "Por médico" — rollup com bruto/imposto/líquido/comissão.
 *   - "Por convênio" — rollup por plano.
 */
export async function renderDoctorPlanMatrixExcel(
  matrix: DoctorPlanMatrix,
  opts: { tenantLabel?: string; from: string; to: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Clinni'
  wb.created = new Date()

  // Ordem estável de colunas = ordem do rollup por plano (maior bruto primeiro).
  const planCols = matrix.byPlan.map((p) => ({ planId: p.planId, planName: p.planName }))

  // ----- Matriz (bruto por célula)
  const grid = wb.addWorksheet('Matriz')
  grid.columns = [
    { header: 'Profissional', key: 'doctor', width: 32 },
    ...planCols.map((p, i) => ({
      header: p.planName,
      key: `plan_${i}`,
      width: 18,
      style: { numFmt: BRL },
    })),
    { header: 'Total', key: 'total', width: 18, style: { numFmt: BRL } },
  ]
  grid.getRow(1).font = { bold: true }

  const grossByKey = new Map<string, number>()
  for (const c of matrix.cells) grossByKey.set(`${c.doctorId}|${c.planId}`, c.grossCents)

  for (const d of matrix.byDoctor) {
    const row: Record<string, string | number> = { doctor: d.doctorName }
    planCols.forEach((p, i) => {
      row[`plan_${i}`] = (grossByKey.get(`${d.doctorId}|${p.planId}`) ?? 0) / 100
    })
    row.total = d.grossCents / 100
    grid.addRow(row)
  }
  const totalRow: Record<string, string | number> = { doctor: 'Total' }
  planCols.forEach((p, i) => {
    const planTotal = matrix.byPlan.find((bp) => bp.planId === p.planId)?.grossCents ?? 0
    totalRow[`plan_${i}`] = planTotal / 100
  })
  totalRow.total = matrix.totals.grossCents / 100
  const tr = grid.addRow(totalRow)
  tr.font = { bold: true }

  // ----- Por médico
  const byDoctor = wb.addWorksheet('Por médico')
  byDoctor.columns = [
    { header: 'Profissional', key: 'doctor', width: 32 },
    { header: 'Procedimentos', key: 'count', width: 16 },
    { header: 'Faturado (BRL)', key: 'gross', width: 18, style: { numFmt: BRL } },
    { header: 'Imposto (BRL)', key: 'tax', width: 18, style: { numFmt: BRL } },
    { header: 'Líquido (BRL)', key: 'net', width: 18, style: { numFmt: BRL } },
    { header: 'Comissão (BRL)', key: 'commission', width: 18, style: { numFmt: BRL } },
  ]
  byDoctor.getRow(1).font = { bold: true }
  for (const d of matrix.byDoctor) {
    byDoctor.addRow({
      doctor: d.doctorName,
      count: d.procedureCount,
      gross: d.grossCents / 100,
      tax: d.taxFromPlanCents / 100,
      net: d.netOfTaxCents / 100,
      commission: d.commissionCents / 100,
    })
  }

  // ----- Por convênio
  const byPlan = wb.addWorksheet('Por convênio')
  byPlan.columns = [
    { header: 'Convênio', key: 'plan', width: 28 },
    { header: 'Procedimentos', key: 'count', width: 16 },
    { header: 'Faturado (BRL)', key: 'gross', width: 18, style: { numFmt: BRL } },
    { header: 'Imposto (BRL)', key: 'tax', width: 18, style: { numFmt: BRL } },
    { header: 'Líquido (BRL)', key: 'net', width: 18, style: { numFmt: BRL } },
    { header: 'Comissão (BRL)', key: 'commission', width: 18, style: { numFmt: BRL } },
  ]
  byPlan.getRow(1).font = { bold: true }
  for (const p of matrix.byPlan) {
    byPlan.addRow({
      plan: p.planName,
      count: p.procedureCount,
      gross: p.grossCents / 100,
      tax: p.taxFromPlanCents / 100,
      net: p.netOfTaxCents / 100,
      commission: p.commissionCents / 100,
    })
  }

  const arr = await wb.xlsx.writeBuffer()
  return Buffer.from(arr)
}

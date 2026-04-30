import ExcelJS from 'exceljs'
import type { PlanDetail } from './by-plan'

const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

export async function renderByPlanExcel(
  detail: PlanDetail,
  opts: { tenantLabel?: string } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Prontool'
  wb.created = new Date()

  // ----- Resumo
  const resumo = wb.addWorksheet('Resumo')
  resumo.columns = [
    { header: 'Métrica', key: 'metric', width: 36 },
    { header: 'Valor', key: 'value', width: 30 },
  ]
  resumo.getRow(1).font = { bold: true }
  if (opts.tenantLabel) resumo.addRow({ metric: 'Clínica', value: opts.tenantLabel })
  resumo.addRow({ metric: 'Plano', value: detail.plan.name })
  const addDate = (label: string, ymd: string) => {
    const r = resumo.addRow({ metric: label, value: new Date(`${ymd}T12:00:00Z`) })
    r.getCell('value').numFmt = 'dd/mm/yyyy'
  }
  addDate('Período de', detail.period.from)
  addDate('Período até', detail.period.to)
  resumo.addRow({})
  resumo.addRow({ metric: 'Total de procedimentos', value: detail.totals.procedureCount })
  const moneyRow = resumo.addRow({
    metric: 'Valor total faturado',
    value: detail.totals.totalRevenueCents / 100,
  })
  moneyRow.getCell('value').numFmt = BRL
  resumo.addRow({})
  resumo.addRow({
    metric: 'Profissional com mais procedimentos',
    value: detail.topDoctor
      ? `${detail.topDoctor.doctorName} (${detail.topDoctor.count})`
      : '—',
  })
  resumo.addRow({
    metric: 'Procedimento mais realizado',
    value: detail.topProcedure
      ? `${detail.topProcedure.procedureName} — ${detail.topProcedure.tussCode} (${detail.topProcedure.count})`
      : '—',
  })

  // ----- Procedimentos
  const procs = wb.addWorksheet('Procedimentos')
  procs.columns = [
    { header: 'Data', key: 'date', width: 18 },
    { header: 'Paciente', key: 'patient', width: 32 },
    { header: 'Código TUSS', key: 'tuss', width: 14 },
    { header: 'Procedimento', key: 'procedure', width: 36 },
    { header: 'Profissional', key: 'doctor', width: 28 },
    { header: 'Valor (BRL)', key: 'amount', width: 18, style: { numFmt: BRL } },
    { header: 'Status', key: 'status', width: 12 },
  ]
  procs.getRow(1).font = { bold: true }
  for (const row of detail.procedures) {
    procs.addRow({
      date: new Date(row.appointmentAt),
      patient: row.patientName,
      tuss: row.tussCode,
      procedure: row.procedureName,
      doctor: row.doctorName,
      amount: row.amountCents / 100,
      status: row.status,
    })
  }
  procs.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm'

  const arr = await wb.xlsx.writeBuffer()
  return Buffer.from(arr)
}

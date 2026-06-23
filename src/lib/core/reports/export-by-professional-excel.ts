import ExcelJS from 'exceljs'
import type { ProfessionalDetail } from './by-professional'

const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

export async function renderByProfessionalExcel(
  detail: ProfessionalDetail,
  opts: { tenantLabel?: string } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Clinni'
  wb.created = new Date()

  // ----- Resumo
  const resumo = wb.addWorksheet('Resumo')
  resumo.columns = [
    { header: 'Métrica', key: 'metric', width: 36 },
    { header: 'Valor', key: 'value', width: 36 },
  ]
  resumo.getRow(1).font = { bold: true }
  if (opts.tenantLabel) resumo.addRow({ metric: 'Clínica', value: opts.tenantLabel })
  resumo.addRow({ metric: 'Profissional', value: detail.doctor.fullName })
  if (detail.doctor.role) resumo.addRow({ metric: 'Função', value: detail.doctor.role })
  if (detail.doctor.specialty)
    resumo.addRow({ metric: 'Especialidade', value: detail.doctor.specialty })
  const registro = formatRegistro(detail.doctor)
  if (registro) resumo.addRow({ metric: 'Registro', value: registro })

  const addDate = (label: string, ymd: string) => {
    const r = resumo.addRow({ metric: label, value: new Date(`${ymd}T12:00:00Z`) })
    r.getCell('value').numFmt = 'dd/mm/yyyy'
  }
  addDate('Período de', detail.period.from)
  addDate('Período até', detail.period.to)
  resumo.addRow({})
  resumo.addRow({
    metric: 'Total de procedimentos',
    value: detail.totals.procedureCount,
  })
  const revRow = resumo.addRow({
    metric: 'Valor total faturado',
    value: detail.totals.totalRevenueCents / 100,
  })
  revRow.getCell('value').numFmt = BRL
  const commRow = resumo.addRow({
    metric: 'Total de comissão',
    value: detail.totals.totalCommissionCents / 100,
  })
  commRow.getCell('value').numFmt = BRL
  const partRow = resumo.addRow({
    metric: 'Honorários de participação',
    value: detail.totals.totalParticipationCents / 100,
  })
  partRow.getCell('value').numFmt = BRL
  const aReceberRow = resumo.addRow({
    metric: 'Total a receber (comissão + participação)',
    value: (detail.totals.totalCommissionCents + detail.totals.totalParticipationCents) / 100,
  })
  aReceberRow.getCell('value').numFmt = BRL
  aReceberRow.font = { bold: true }
  const taxRow = resumo.addRow({
    metric: 'Imposto do convênio',
    value: detail.totals.totalTaxFromPlanCents / 100,
  })
  taxRow.getCell('value').numFmt = BRL
  const netRow = resumo.addRow({
    metric: 'Receita líquida (após imposto)',
    value: detail.totals.totalNetOfTaxCents / 100,
  })
  netRow.getCell('value').numFmt = BRL
  resumo.addRow({})
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
    { header: 'Plano/Particular', key: 'plan', width: 24 },
    { header: 'Valor (BRL)', key: 'amount', width: 16, style: { numFmt: BRL } },
    { header: 'Comissão %', key: 'commPct', width: 12 },
    { header: 'Comissão (BRL)', key: 'commission', width: 18, style: { numFmt: BRL } },
    { header: 'Status', key: 'status', width: 12 },
  ]
  procs.getRow(1).font = { bold: true }
  for (const row of detail.procedures) {
    procs.addRow({
      date: new Date(row.appointmentAt),
      patient: row.patientName,
      tuss: row.tussCode,
      procedure: row.procedureName,
      plan: row.planName,
      amount: row.amountCents / 100,
      commPct: row.commissionBps / 100,
      commission: row.commissionCents / 100,
      status: row.status,
    })
  }
  procs.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm'
  procs.getColumn('commPct').numFmt = '0.00"%"'

  // ----- Participações (equipe/instrumentação)
  if (detail.participations.length > 0) {
    const part = wb.addWorksheet('Participações')
    part.columns = [
      { header: 'Data', key: 'date', width: 18 },
      { header: 'Código TUSS', key: 'tuss', width: 14 },
      { header: 'Procedimento', key: 'procedure', width: 36 },
      { header: 'Grau', key: 'degree', width: 16 },
      { header: 'Honorário (BRL)', key: 'amount', width: 18, style: { numFmt: BRL } },
    ]
    part.getRow(1).font = { bold: true }
    for (const p of detail.participations) {
      part.addRow({
        date: new Date(p.appointmentAt),
        tuss: p.tussCode,
        procedure: p.procedureName,
        degree: p.participationDegree ?? '—',
        amount: p.amountCents / 100,
      })
    }
    part.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm'
  }

  // ----- Por convênio
  if (detail.byPlan.length > 0) {
    const porPlano = wb.addWorksheet('Por convênio')
    porPlano.columns = [
      { header: 'Convênio', key: 'plan', width: 28 },
      { header: 'Procedimentos', key: 'count', width: 16 },
      { header: 'Faturado (BRL)', key: 'gross', width: 18, style: { numFmt: BRL } },
      { header: 'Imposto (BRL)', key: 'tax', width: 18, style: { numFmt: BRL } },
      { header: 'Líquido (BRL)', key: 'net', width: 18, style: { numFmt: BRL } },
      { header: 'Comissão (BRL)', key: 'commission', width: 18, style: { numFmt: BRL } },
    ]
    porPlano.getRow(1).font = { bold: true }
    for (const p of detail.byPlan) {
      porPlano.addRow({
        plan: p.planName,
        count: p.procedureCount,
        gross: p.grossCents / 100,
        tax: p.taxFromPlanCents / 100,
        net: p.netOfTaxCents / 100,
        commission: p.commissionCents / 100,
      })
    }
  }

  const arr = await wb.xlsx.writeBuffer()
  return Buffer.from(arr)
}

function formatRegistro(d: ProfessionalDetail['doctor']): string | null {
  const council = d.councilName ?? null
  const number = d.councilNumber ?? d.crm ?? null
  if (!council && !number) return null
  return [council, number].filter(Boolean).join(' ')
}

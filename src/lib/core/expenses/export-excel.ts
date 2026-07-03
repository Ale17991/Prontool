import ExcelJS from 'exceljs'

const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

const CATEGORY_LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  equipamentos: 'Equipamentos',
  materiais: 'Materiais',
  pessoal: 'Pessoal',
  servicos: 'Serviços',
  impostos: 'Impostos',
  manutencao: 'Manutenção',
  outros: 'Outros',
}

const FREQ_LABEL: Record<string, string> = {
  mensal: 'Mensal',
  semanal: 'Semanal',
  anual: 'Anual',
}

export interface ExpenseExportRow {
  competence_date: string
  category: string
  description: string
  supplier: string | null
  amount_cents: number
  recurring: boolean
  frequency: string | null
  tax_name?: string | null
}

export interface ExpenseExportMeta {
  tenantLabel?: string
  from?: string | null
  to?: string | null
  category?: string | null
}

/** Relatório de despesas para a contabilidade (Excel). Backlog 4. */
export async function renderExpensesExcel(
  rows: ExpenseExportRow[],
  meta: ExpenseExportMeta = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Clinni'
  wb.created = new Date()

  const ws = wb.addWorksheet('Despesas')
  ws.columns = [
    { header: 'Competência', key: 'date', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Categoria', key: 'category', width: 18 },
    { header: 'Descrição', key: 'description', width: 40 },
    { header: 'Fornecedor', key: 'supplier', width: 26 },
    { header: 'Recorrência', key: 'recurring', width: 14 },
    { header: 'Imposto', key: 'tax', width: 20 },
    { header: 'Valor', key: 'amount', width: 18, style: { numFmt: BRL } },
  ]
  ws.getRow(1).font = { bold: true }

  for (const r of rows) {
    const row = ws.addRow({
      date: new Date(`${r.competence_date}T12:00:00Z`),
      category: CATEGORY_LABEL[r.category] ?? r.category,
      description: r.description,
      supplier: r.supplier ?? '',
      recurring: r.recurring ? (FREQ_LABEL[r.frequency ?? ''] ?? 'Recorrente') : 'Avulsa',
      tax: r.tax_name ?? '',
      amount: r.amount_cents / 100,
    })
    row.getCell('date').numFmt = 'dd/mm/yyyy'
  }

  // Linha de total.
  const totalCents = rows.reduce((acc, r) => acc + Number(r.amount_cents), 0)
  ws.addRow({})
  const totalRow = ws.addRow({ description: 'TOTAL', amount: totalCents / 100 })
  totalRow.font = { bold: true }
  totalRow.getCell('amount').numFmt = BRL

  // Aba de metadados (período/clínica/filtro) para a contabilidade.
  const info = wb.addWorksheet('Resumo')
  info.columns = [
    { header: 'Campo', key: 'k', width: 24 },
    { header: 'Valor', key: 'v', width: 36 },
  ]
  info.getRow(1).font = { bold: true }
  if (meta.tenantLabel) info.addRow({ k: 'Clínica', v: meta.tenantLabel })
  info.addRow({ k: 'Período de', v: meta.from ?? '—' })
  info.addRow({ k: 'Período até', v: meta.to ?? '—' })
  info.addRow({
    k: 'Categoria',
    v:
      meta.category && meta.category !== 'all'
        ? (CATEGORY_LABEL[meta.category] ?? meta.category)
        : 'Todas',
  })
  info.addRow({ k: 'Lançamentos', v: rows.length })
  const t = info.addRow({ k: 'Total', v: totalCents / 100 })
  t.getCell('v').numFmt = BRL

  const arr = await wb.xlsx.writeBuffer()
  return Buffer.from(arr)
}

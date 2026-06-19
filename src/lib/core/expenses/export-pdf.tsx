import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { ExpenseExportRow, ExpenseExportMeta } from './export-excel'

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

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#0f172a' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  meta: { fontSize: 8, color: '#64748b', marginBottom: 10 },
  trHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    minHeight: 20,
    alignItems: 'center',
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    minHeight: 18,
    alignItems: 'center',
  },
  th: { paddingHorizontal: 5, paddingVertical: 4, fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#334155' },
  td: { paddingHorizontal: 5, paddingVertical: 4, fontSize: 8 },
  cDate: { width: 58 },
  cCat: { width: 64 },
  cDesc: { flex: 1 },
  cSup: { width: 90 },
  cAmount: { width: 70, textAlign: 'right' },
  totalRow: { flexDirection: 'row', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#cbd5e1' },
  totalLabel: { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 9, paddingRight: 8 },
  totalValue: { width: 70, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 9 },
})

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function ddmmyyyy(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}

export async function renderExpensesPdf(
  rows: ExpenseExportRow[],
  meta: ExpenseExportMeta & { clinicProfile?: ClinicProfile | null; signedLogoUrl?: string | null } = {},
): Promise<Buffer> {
  const totalCents = rows.reduce((acc, r) => acc + Number(r.amount_cents), 0)
  const periodo =
    meta.from || meta.to ? `Período: ${meta.from ?? '…'} a ${meta.to ?? '…'}` : 'Período: todos'
  const catLabel =
    meta.category && meta.category !== 'all'
      ? CATEGORY_LABEL[meta.category] ?? meta.category
      : 'Todas as categorias'

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={meta.clinicProfile ?? null}
          signedLogoUrl={meta.signedLogoUrl ?? null}
          subtitle="Relatório de despesas"
        />
        <Text style={styles.title}>Despesas</Text>
        <Text style={styles.meta}>
          {periodo} · {catLabel} · {rows.length} lançamento{rows.length === 1 ? '' : 's'}
        </Text>

        <View style={styles.trHeader}>
          <Text style={[styles.th, styles.cDate]}>Competência</Text>
          <Text style={[styles.th, styles.cCat]}>Categoria</Text>
          <Text style={[styles.th, styles.cDesc]}>Descrição</Text>
          <Text style={[styles.th, styles.cSup]}>Fornecedor</Text>
          <Text style={[styles.th, styles.cAmount]}>Valor</Text>
        </View>
        {rows.map((r, i) => (
          <View style={styles.tr} key={i} wrap={false}>
            <Text style={[styles.td, styles.cDate]}>{ddmmyyyy(r.competence_date)}</Text>
            <Text style={[styles.td, styles.cCat]}>{CATEGORY_LABEL[r.category] ?? r.category}</Text>
            <Text style={[styles.td, styles.cDesc]}>
              {r.description}
              {r.recurring ? ` (recorrente)` : ''}
              {r.tax_name ? ` · ${r.tax_name}` : ''}
            </Text>
            <Text style={[styles.td, styles.cSup]}>{r.supplier ?? '—'}</Text>
            <Text style={[styles.td, styles.cAmount]}>{brl(r.amount_cents)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{brl(totalCents)}</Text>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

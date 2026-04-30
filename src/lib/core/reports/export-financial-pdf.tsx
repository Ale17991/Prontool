import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { FinancialReport } from './financial-report'

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#0f172a',
  },
  header: {
    marginBottom: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  eyebrow: {
    fontSize: 8,
    color: '#64748b',
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  subtitle: { color: '#64748b', fontSize: 9 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 16,
    marginBottom: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    minHeight: 18,
    alignItems: 'center',
  },
  trHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    minHeight: 22,
    alignItems: 'center',
  },
  th: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#334155',
  },
  td: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 8,
  },
  cellName: { flex: 2 },
  cellMetric: { flex: 1, textAlign: 'right' },
  cellCount: { flex: 0.7, textAlign: 'right' },
  emptyNote: { padding: 12, color: '#64748b', fontSize: 8 },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  summaryCard: {
    width: '24%',
    marginRight: '1.33%',
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    marginBottom: 6,
  },
  summaryLabel: {
    fontSize: 7,
    color: '#64748b',
    letterSpacing: 1,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  summaryValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  profitCard: {
    marginTop: 12,
    padding: 16,
    backgroundColor: '#0f172a',
    borderRadius: 6,
  },
  profitLabel: { color: '#94a3b8', fontSize: 8, letterSpacing: 1 },
  profitValue: { color: '#ffffff', fontSize: 22, fontFamily: 'Helvetica-Bold' },
  profitMargin: { color: '#22c55e', fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  profitMarginNeg: { color: '#ef4444' },
  footer: {
    marginTop: 18,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
  comparisonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  pos: { color: '#16a34a', fontFamily: 'Helvetica-Bold' },
  neg: { color: '#dc2626', fontFamily: 'Helvetica-Bold' },
})

const CATEGORY_LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  equipamentos: 'Equipamentos',
  materiais: 'Materiais',
  pessoal: 'Pessoal',
  servicos: 'Serviços',
  outros: 'Outros',
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function formatPct(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function FinancialReportDocument({
  report,
  tenantLabel,
}: {
  report: FinancialReport
  tenantLabel?: string
}) {
  const { period, previousPeriod, totals, previous, comparison } = report
  const profitNeg = totals.operatingProfitCents < 0

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Relatório financeiro · Prontool</Text>
          <Text style={styles.title}>
            {formatDate(period.from)} – {formatDate(period.to)}
          </Text>
          <Text style={styles.subtitle}>
            {tenantLabel ?? ''}
            {tenantLabel ? ' · ' : ''}
            {totals.appointmentCount} atendimentos · comparativo {formatDate(previousPeriod.from)}{' '}
            – {formatDate(previousPeriod.to)}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Resultado operacional</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Faturamento bruto</Text>
            <Text style={styles.summaryValue}>{formatBRL(totals.grossRevenueCents)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Comissões pagas</Text>
            <Text style={styles.summaryValue}>-{formatBRL(totals.commissionsCents)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Receita líquida</Text>
            <Text style={styles.summaryValue}>{formatBRL(totals.netRevenueCents)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total despesas</Text>
            <Text style={styles.summaryValue}>-{formatBRL(totals.totalExpensesCents)}</Text>
          </View>
        </View>
        <View style={styles.profitCard}>
          <Text style={styles.profitLabel}>LUCRO OPERACIONAL</Text>
          <Text style={styles.profitValue}>{formatBRL(totals.operatingProfitCents)}</Text>
          <Text style={[styles.profitMargin, profitNeg ? styles.profitMarginNeg : {}]}>
            Margem op. {totals.operatingMarginPct.toFixed(1)}%
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Receita por plano de saúde</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellName]}>Convênio</Text>
            <Text style={[styles.th, styles.cellCount]}>Atend.</Text>
            <Text style={[styles.th, styles.cellMetric]}>Total bruto</Text>
            <Text style={[styles.th, styles.cellCount]}>Share</Text>
          </View>
          {report.revenueByPlan.length === 0 ? (
            <Text style={styles.emptyNote}>Sem dados no período.</Text>
          ) : (
            report.revenueByPlan.map((row) => (
              <View key={row.planId} style={styles.tr}>
                <Text style={[styles.td, styles.cellName]}>{row.planName}</Text>
                <Text style={[styles.td, styles.cellCount]}>{row.appointmentCount}</Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.grossRevenueCents)}
                </Text>
                <Text style={[styles.td, styles.cellCount]}>
                  {row.marketSharePct.toFixed(1)}%
                </Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>Top profissionais</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellName]}>Profissional</Text>
            <Text style={[styles.th, styles.cellCount]}>Atend.</Text>
            <Text style={[styles.th, styles.cellMetric]}>Faturamento</Text>
          </View>
          {report.topDoctors.length === 0 ? (
            <Text style={styles.emptyNote}>Sem dados no período.</Text>
          ) : (
            report.topDoctors.map((row) => (
              <View key={row.doctorId} style={styles.tr}>
                <Text style={[styles.td, styles.cellName]}>{row.doctorName}</Text>
                <Text style={[styles.td, styles.cellCount]}>{row.appointmentCount}</Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.grossRevenueCents)}
                </Text>
              </View>
            ))
          )}
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Ranking de procedimentos</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellName]}>Procedimento</Text>
            <Text style={[styles.th, styles.cellCount]}>Qtd.</Text>
            <Text style={[styles.th, styles.cellMetric]}>Total</Text>
          </View>
          {report.topProcedures.length === 0 ? (
            <Text style={styles.emptyNote}>Sem dados no período.</Text>
          ) : (
            report.topProcedures.map((row) => (
              <View key={row.procedureId} style={styles.tr}>
                <Text style={[styles.td, styles.cellName]}>
                  {row.procedureName}
                  {row.tussCode ? ` · ${row.tussCode}` : ''}
                </Text>
                <Text style={[styles.td, styles.cellCount]}>{row.count}</Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.totalCents)}
                </Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>Fluxo de despesas</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellName]}>Categoria</Text>
            <Text style={[styles.th, styles.cellCount]}>Qtd.</Text>
            <Text style={[styles.th, styles.cellMetric]}>Total</Text>
            <Text style={[styles.th, styles.cellCount]}>%</Text>
          </View>
          {report.expensesByCategory.length === 0 ? (
            <Text style={styles.emptyNote}>Sem despesas no período.</Text>
          ) : (
            report.expensesByCategory.map((row) => (
              <View key={row.category} style={styles.tr}>
                <Text style={[styles.td, styles.cellName]}>
                  {CATEGORY_LABEL[row.category] ?? row.category}
                </Text>
                <Text style={[styles.td, styles.cellCount]}>{row.count}</Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.totalCents)}
                </Text>
                <Text style={[styles.td, styles.cellCount]}>{row.pct.toFixed(1)}%</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>
          Comparativo com {formatDate(previousPeriod.from)} – {formatDate(previousPeriod.to)}
        </Text>
        <View style={[styles.table, { padding: 8 }]}>
          <ComparisonLine
            label="Receita bruta"
            current={totals.grossRevenueCents}
            previous={previous.grossRevenueCents}
            pct={comparison.revenuePct}
            positiveIsGood
          />
          <ComparisonLine
            label="Despesas"
            current={totals.totalExpensesCents}
            previous={previous.totalExpensesCents}
            pct={comparison.expensesPct}
            positiveIsGood={false}
          />
          <ComparisonLine
            label="Lucro operacional"
            current={totals.operatingProfitCents}
            previous={previous.operatingProfitCents}
            pct={comparison.profitPct}
            positiveIsGood
          />
        </View>

        <Text style={styles.footer}>
          Gerado em {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ·
          Prontool — relatório financeiro consolidado.
        </Text>
      </Page>
    </Document>
  )
}

function ComparisonLine({
  label,
  current,
  previous,
  pct,
  positiveIsGood,
}: {
  label: string
  current: number
  previous: number
  pct: number | null
  positiveIsGood: boolean
}) {
  const positive = (pct ?? 0) > 0
  const isGood = positive === positiveIsGood
  return (
    <View style={styles.comparisonRow}>
      <Text>{label}</Text>
      <Text>
        {formatBRL(current)} vs {formatBRL(previous)}{' '}
        <Text style={isGood ? styles.pos : styles.neg}>{formatPct(pct)}</Text>
      </Text>
    </View>
  )
}

export async function renderFinancialReportPdf(
  report: FinancialReport,
  opts: { tenantLabel?: string } = {},
): Promise<Buffer> {
  return renderToBuffer(
    <FinancialReportDocument report={report} tenantLabel={opts.tenantLabel} />,
  )
}

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { MonthlyReport } from './monthly'

/**
 * T140 — Renderiza um MonthlyReport em PDF A4. Consome exatamente o
 * mesmo DTO do JSON/Excel para garantir paridade numérica (SC-006).
 *
 * Layout: cabeçalho com período + tenant label, tabela de receita por
 * plano, tabela de produção por médico, rodapé com totais.
 */
const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#0f172a',
  },
  header: {
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  eyebrow: {
    fontSize: 8,
    color: '#64748b',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
    fontFamily: 'Helvetica-Bold',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  subtitle: { color: '#64748b', fontSize: 10 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    marginTop: 18,
    marginBottom: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    minHeight: 22,
    alignItems: 'center',
  },
  trHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    minHeight: 24,
    alignItems: 'center',
  },
  th: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: '#334155',
  },
  td: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 9,
  },
  cellName: { flex: 2 },
  cellMetric: { flex: 1, textAlign: 'right' },
  cellCount: { flex: 0.8, textAlign: 'right' },
  totals: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#0f172a',
    color: '#ffffff',
    borderRadius: 6,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalsLabel: { fontSize: 9, color: '#94a3b8', letterSpacing: 1 },
  totalsValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  totalsBig: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  footer: {
    marginTop: 24,
    fontSize: 8,
    color: '#94a3b8',
    textAlign: 'center',
  },
  mutedCell: { color: '#64748b' },
  emptyNote: { padding: 16, color: '#64748b', fontSize: 9 },
})

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export function MonthlyReportDocument({
  report,
  tenantLabel,
}: {
  report: MonthlyReport
  tenantLabel?: string
}) {
  const { period, revenueByPlan, productionByDoctor, totals } = report

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Relatório mensal · Pronttu</Text>
          <Text style={styles.title}>
            {formatDate(period.from)} – {formatDate(period.to)}
          </Text>
          <Text style={styles.subtitle}>
            {tenantLabel ?? ''}
            {tenantLabel ? ' · ' : ''}
            {totals.appointmentCount} atendimento{totals.appointmentCount === 1 ? '' : 's'}
            {totals.reversalCount > 0
              ? ` · ${totals.reversalCount} estornado${totals.reversalCount === 1 ? '' : 's'}`
              : ''}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Receita por plano</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellName]}>Plano</Text>
            <Text style={[styles.th, styles.cellMetric]}>Receita líquida</Text>
            <Text style={[styles.th, styles.cellCount]}>Atendimentos</Text>
          </View>
          {revenueByPlan.length === 0 ? (
            <Text style={styles.emptyNote}>Nenhuma receita no período.</Text>
          ) : (
            revenueByPlan.map((row) => (
              <View key={row.planId} style={styles.tr}>
                <Text style={[styles.td, styles.cellName]}>{row.planName}</Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.netRevenueCents)}
                </Text>
                <Text style={[styles.td, styles.cellCount, styles.mutedCell]}>
                  {row.appointmentCount}
                </Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>Produção por profissional</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellName]}>Profissional</Text>
            <Text style={[styles.th, styles.cellMetric]}>Produção líquida</Text>
            <Text style={[styles.th, styles.cellMetric]}>Comissão líquida</Text>
            <Text style={[styles.th, styles.cellCount]}>Atend.</Text>
          </View>
          {productionByDoctor.length === 0 ? (
            <Text style={styles.emptyNote}>Nenhuma produção no período.</Text>
          ) : (
            productionByDoctor.map((row) => (
              <View key={row.doctorId} style={styles.tr}>
                <Text style={[styles.td, styles.cellName]}>{row.doctorName}</Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.netProductionCents)}
                </Text>
                <Text style={[styles.td, styles.cellMetric]}>
                  {formatBRL(row.netCommissionCents)}
                </Text>
                <Text style={[styles.td, styles.cellCount, styles.mutedCell]}>
                  {row.appointmentCount}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.totals}>
          <Text style={styles.totalsLabel}>RECEITA LÍQUIDA TOTAL</Text>
          <Text style={styles.totalsBig}>{formatBRL(totals.netRevenueCents)}</Text>
          <View style={{ height: 12 }} />
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Comissão líquida</Text>
            <Text style={styles.totalsValue}>{formatBRL(totals.netCommissionCents)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Atendimentos</Text>
            <Text style={styles.totalsValue}>{totals.appointmentCount}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Estornos</Text>
            <Text style={styles.totalsValue}>{totals.reversalCount}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Gerado em {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Os
          valores refletem appointments_effective (já considera estornos).
        </Text>
      </Page>
    </Document>
  )
}

export async function renderMonthlyReportPdf(
  report: MonthlyReport,
  opts: { tenantLabel?: string } = {},
): Promise<Buffer> {
  return renderToBuffer(
    <MonthlyReportDocument report={report} tenantLabel={opts.tenantLabel} />,
  )
}

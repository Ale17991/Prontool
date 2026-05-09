import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { PlanDetail } from './by-plan'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#0f172a',
  },
  header: {
    marginBottom: 14,
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
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  subtitle: { color: '#64748b', fontSize: 9 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 14,
    marginBottom: 6,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  summaryCard: {
    width: '48%',
    marginRight: '2%',
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
  summaryValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 4 },
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
    paddingHorizontal: 4,
    paddingVertical: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    color: '#334155',
  },
  td: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    fontSize: 7,
  },
  cellDate: { width: '14%' },
  cellPatient: { width: '22%' },
  cellTuss: { width: '12%' },
  cellProc: { width: '24%' },
  cellDoctor: { width: '18%' },
  cellAmount: { width: '10%', textAlign: 'right' },
  emptyNote: { padding: 12, color: '#64748b', fontSize: 8 },
  totals: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#0f172a',
    color: '#ffffff',
    borderRadius: 6,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalsLabel: { fontSize: 8, color: '#94a3b8', letterSpacing: 1 },
  totalsValue: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  totalsBig: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  footer: {
    marginTop: 14,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
})

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ByPlanReportDocument({
  detail,
  tenantLabel,
  clinicProfile,
  signedLogoUrl,
}: {
  detail: PlanDetail
  tenantLabel?: string
  clinicProfile?: ClinicProfile | null
  signedLogoUrl?: string | null
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={clinicProfile ?? null}
          signedLogoUrl={signedLogoUrl ?? null}
          subtitle={`Relatório por plano · ${detail.plan.name} · ${formatDate(detail.period.from)} – ${formatDate(detail.period.to)} · ${detail.totals.procedureCount} procedimento${detail.totals.procedureCount === 1 ? '' : 's'}${tenantLabel ? ` · ${tenantLabel}` : ''}`}
        />

        <Text style={styles.sectionTitle}>Resumo do período</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total de procedimentos</Text>
            <Text style={styles.summaryValue}>{detail.totals.procedureCount}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Valor total faturado</Text>
            <Text style={styles.summaryValue}>
              {formatBRL(detail.totals.totalRevenueCents)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Profissional com mais procedimentos</Text>
            <Text style={styles.summaryValue}>
              {detail.topDoctor
                ? `${detail.topDoctor.doctorName} (${detail.topDoctor.count})`
                : '—'}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Procedimento mais realizado</Text>
            <Text style={styles.summaryValue}>
              {detail.topProcedure
                ? `${detail.topProcedure.procedureName} (${detail.topProcedure.count})`
                : '—'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Procedimentos do período</Text>
        <View style={styles.table}>
          <View style={styles.trHeader}>
            <Text style={[styles.th, styles.cellDate]}>Data</Text>
            <Text style={[styles.th, styles.cellPatient]}>Paciente</Text>
            <Text style={[styles.th, styles.cellTuss]}>TUSS</Text>
            <Text style={[styles.th, styles.cellProc]}>Procedimento</Text>
            <Text style={[styles.th, styles.cellDoctor]}>Profissional</Text>
            <Text style={[styles.th, styles.cellAmount]}>Valor</Text>
          </View>
          {detail.procedures.length === 0 ? (
            <Text style={styles.emptyNote}>Sem procedimentos no período.</Text>
          ) : (
            detail.procedures.map((row) => (
              <View key={row.appointmentId} style={styles.tr}>
                <Text style={[styles.td, styles.cellDate]}>
                  {formatDateTime(row.appointmentAt)}
                </Text>
                <Text style={[styles.td, styles.cellPatient]}>{row.patientName}</Text>
                <Text style={[styles.td, styles.cellTuss]}>{row.tussCode}</Text>
                <Text style={[styles.td, styles.cellProc]}>{row.procedureName}</Text>
                <Text style={[styles.td, styles.cellDoctor]}>{row.doctorName}</Text>
                <Text style={[styles.td, styles.cellAmount]}>
                  {formatBRL(row.amountCents)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.totals}>
          <Text style={styles.totalsLabel}>VALOR TOTAL FATURADO</Text>
          <Text style={styles.totalsBig}>
            {formatBRL(detail.totals.totalRevenueCents)}
          </Text>
          <View style={{ height: 8 }} />
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Procedimentos</Text>
            <Text style={styles.totalsValue}>{detail.totals.procedureCount}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Gerado em{' '}
          {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Apenas
          atendimentos ativos (estornos excluídos).
        </Text>
      </Page>
    </Document>
  )
}

export async function renderByPlanPdf(
  detail: PlanDetail,
  opts: {
    tenantLabel?: string
    clinicProfile?: ClinicProfile | null
    signedLogoUrl?: string | null
  } = {},
): Promise<Buffer> {
  return renderToBuffer(
    <ByPlanReportDocument
      detail={detail}
      tenantLabel={opts.tenantLabel}
      clinicProfile={opts.clinicProfile ?? null}
      signedLogoUrl={opts.signedLogoUrl ?? null}
    />,
  )
}

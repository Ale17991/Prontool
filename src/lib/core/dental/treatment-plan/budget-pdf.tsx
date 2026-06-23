/* eslint-disable react/no-unknown-property */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import { surfaceLabel, type Surface } from '@/lib/core/dental/teeth'

export interface BudgetPdfItem {
  toothFdi: number | null
  surface: Surface | null
  title: string
  priceCents: number | null
}

export interface BudgetPdfInput {
  clinicProfile: ClinicProfile | null
  patientName: string
  budget: { title: string | null; status: string; totalCents: number; acceptedAt: string | null }
  items: BudgetPdfItem[]
}

const STATUS_LABEL: Record<string, string> = {
  proposto: 'Proposto',
  apresentado: 'Apresentado',
  aceito: 'Aceito',
  recusado: 'Recusado',
}

function brl(cents: number | null): string {
  if (cents === null) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function position(toothFdi: number | null, surface: Surface | null): string {
  if (toothFdi === null) return '—'
  return surface ? `Dente ${toothFdi} · ${surfaceLabel(surface, toothFdi)}` : `Dente ${toothFdi}`
}

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 56, fontSize: 9, fontFamily: 'Helvetica', color: '#0f172a' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtle: { color: '#64748b', fontSize: 8 },
  meta: { marginBottom: 10 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 4 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingVertical: 4 },
  cPos: { width: '32%' },
  cProc: { width: '48%' },
  cVal: { width: '20%', textAlign: 'right' },
  label: { fontSize: 7, color: '#64748b', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totalBox: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
})

export async function renderBudgetPdf(input: BudgetPdfInput): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Orçamento de tratamento odontológico" />

        <View style={styles.meta}>
          <Text style={styles.title}>{input.budget.title || 'Orçamento'}</Text>
          <Text style={styles.subtle}>Paciente: {input.patientName}</Text>
          <Text style={styles.subtle}>
            Situação: {STATUS_LABEL[input.budget.status] ?? input.budget.status}
            {input.budget.acceptedAt ? ` · Aceito em ${new Date(input.budget.acceptedAt).toLocaleDateString('pt-BR')}` : ''}
          </Text>
        </View>

        <View style={styles.head}>
          <Text style={[styles.cPos, styles.label]}>Posição</Text>
          <Text style={[styles.cProc, styles.label]}>Procedimento</Text>
          <Text style={[styles.cVal, styles.label]}>Valor</Text>
        </View>
        {input.items.map((it, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.cPos}>{position(it.toothFdi, it.surface)}</Text>
            <Text style={styles.cProc}>{it.title}</Text>
            <Text style={styles.cVal}>{brl(it.priceCents)}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalBox}>Total: {brl(input.budget.totalCents)}</Text>
        </View>
      </Page>
    </Document>
  )
  return renderToBuffer(doc)
}

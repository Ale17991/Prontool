import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { ExamRequest } from './crud'

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#0f172a', lineHeight: 1.5 },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  patient: { fontSize: 11, marginBottom: 12, color: '#334155' },
  section: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  indication: { fontSize: 11, textAlign: 'justify', marginBottom: 12, color: '#334155' },
  item: { flexDirection: 'row', marginBottom: 3 },
  itemCode: { width: 80, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  itemDesc: { flex: 1, fontSize: 11 },
  notes: { fontSize: 10, color: '#475569', marginTop: 12 },
  date: { fontSize: 11, marginTop: 24, textAlign: 'right' },
  sign: { marginTop: 56, alignItems: 'center' },
  signLine: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    width: 240,
    paddingTop: 4,
    textAlign: 'center',
    fontSize: 10,
    color: '#334155',
  },
})

function ddmmyyyyLong(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export async function renderExamRequestPdf(
  reqDoc: ExamRequest,
  meta: {
    patientName: string
    clinicProfile?: ClinicProfile | null
    signedLogoUrl?: string | null
  },
): Promise<Buffer> {
  const cityUf = meta.clinicProfile?.address.city
    ? `${meta.clinicProfile.address.city}${meta.clinicProfile.address.uf ? `/${meta.clinicProfile.address.uf}` : ''}, `
    : ''
  const tech = meta.clinicProfile?.techResponsible
  const signName = tech?.name ?? meta.clinicProfile?.displayName ?? ''
  const signReg = [tech?.council, tech?.registration].filter(Boolean).join(' ')

  const element = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={meta.clinicProfile ?? null}
          signedLogoUrl={meta.signedLogoUrl ?? null}
          subtitle="Solicitação de exame"
        />
        <Text style={styles.title}>Solicitação de exame</Text>
        <Text style={styles.patient}>Paciente: {meta.patientName}</Text>

        {reqDoc.clinicalIndication ? (
          <>
            <Text style={styles.section}>Indicação clínica</Text>
            <Text style={styles.indication}>{reqDoc.clinicalIndication}</Text>
          </>
        ) : null}

        <Text style={styles.section}>Exames solicitados</Text>
        {reqDoc.items.map((it, idx) => (
          <View key={idx} style={styles.item}>
            <Text style={styles.itemCode}>{it.code ?? '—'}</Text>
            <Text style={styles.itemDesc}>{it.description}</Text>
          </View>
        ))}

        {reqDoc.notes ? <Text style={styles.notes}>Observações: {reqDoc.notes}</Text> : null}

        <Text style={styles.date}>
          {cityUf}
          {ddmmyyyyLong(reqDoc.createdAt)}
        </Text>
        <View style={styles.sign}>
          <Text style={styles.signLine}>
            {signName}
            {signReg ? `\n${signReg}` : ''}
          </Text>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(element)
}

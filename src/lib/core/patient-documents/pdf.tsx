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
import type { PatientDocumentRow } from './list'

const TYPE_LABEL: Record<string, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  outro: 'Documento',
}

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#0f172a', lineHeight: 1.5 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 8, marginBottom: 16 },
  patient: { fontSize: 11, marginBottom: 12, color: '#334155' },
  body: { fontSize: 11, textAlign: 'justify', marginBottom: 16, whiteSpace: 'pre-wrap' },
  cid: { fontSize: 10, color: '#475569', marginBottom: 16 },
  date: { fontSize: 11, marginTop: 24, textAlign: 'right' },
  sign: { marginTop: 56, alignItems: 'center' },
  signLine: { borderTopWidth: 1, borderTopColor: '#334155', width: 240, paddingTop: 4, textAlign: 'center', fontSize: 10, color: '#334155' },
})

function ddmmyyyyLong(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export async function renderPatientDocumentPdf(
  doc: PatientDocumentRow,
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
      <Page size={doc.paperSize} style={[styles.page, { fontSize: doc.fontSize }]}>
        <ClinicHeader
          profile={meta.clinicProfile ?? null}
          signedLogoUrl={meta.signedLogoUrl ?? null}
          subtitle={TYPE_LABEL[doc.docType] ?? 'Documento'}
        />
        <Text style={styles.title}>{doc.title}</Text>
        <Text style={styles.patient}>Paciente: {meta.patientName}</Text>
        <Text style={[styles.body, { fontSize: doc.fontSize }]}>{doc.body}</Text>
        {doc.cidCode || doc.cidDescription ? (
          <Text style={styles.cid}>
            CID: {[doc.cidCode, doc.cidDescription].filter(Boolean).join(' — ')}
          </Text>
        ) : null}
        <Text style={styles.date}>
          {cityUf}
          {ddmmyyyyLong(doc.createdAt)}
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

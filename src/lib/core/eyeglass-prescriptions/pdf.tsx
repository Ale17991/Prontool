import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { EyeglassRx, EyeData } from './crud'

const styles = StyleSheet.create({
  page: { padding: 44, fontSize: 10, fontFamily: 'Helvetica', color: '#0f172a' },
  title: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  patient: { fontSize: 10, marginBottom: 12, color: '#334155' },
  trHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  tr: {
    flexDirection: 'row',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#cbd5e1',
  },
  th: {
    padding: 5,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#334155',
    textAlign: 'center',
    borderRightWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  td: {
    padding: 5,
    fontSize: 9,
    textAlign: 'center',
    borderRightWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  cEye: { width: 88, textAlign: 'left' },
  cVal: { flex: 1 },
  meta: { marginTop: 14, fontSize: 10 },
  notes: { marginTop: 8, fontSize: 9, color: '#475569' },
  date: { marginTop: 22, fontSize: 10, textAlign: 'right' },
  sign: { marginTop: 50, alignItems: 'center' },
  signLine: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    width: 240,
    paddingTop: 4,
    textAlign: 'center',
    fontSize: 9,
    color: '#334155',
  },
})

const COLS: Array<{ label: string; key: keyof EyeData }> = [
  { label: 'Esférico', key: 'sphere' },
  { label: 'Cilíndrico', key: 'cylinder' },
  { label: 'Eixo', key: 'axis' },
  { label: 'Adição', key: 'addition' },
  { label: 'Prisma', key: 'prism' },
  { label: 'Base', key: 'base' },
  { label: 'DNP', key: 'dnp' },
]

function dash(v: string | null): string {
  return v && v.trim() ? v : '—'
}

function EyeRow({ label, eye }: { label: string; eye: EyeData }) {
  return (
    <View style={styles.tr}>
      <Text style={[styles.td, styles.cEye]}>{label}</Text>
      {COLS.map((c) => (
        <Text key={c.key} style={[styles.td, styles.cVal]}>
          {dash(eye[c.key])}
        </Text>
      ))}
    </View>
  )
}

export async function renderEyeglassRxPdf(
  rx: EyeglassRx,
  meta: {
    patientName: string
    clinicProfile?: ClinicProfile | null
    signedLogoUrl?: string | null
  },
): Promise<Buffer> {
  const tech = meta.clinicProfile?.techResponsible
  const signName = tech?.name ?? meta.clinicProfile?.displayName ?? ''
  const signReg = [tech?.council, tech?.registration].filter(Boolean).join(' ')
  const dateBr = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rx.createdAt)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
  })()

  const element = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={meta.clinicProfile ?? null}
          signedLogoUrl={meta.signedLogoUrl ?? null}
          subtitle="Receita de óculos"
        />
        <Text style={styles.title}>Receita de óculos</Text>
        <Text style={styles.patient}>Paciente: {meta.patientName}</Text>

        <View style={styles.trHeader}>
          <Text style={[styles.th, styles.cEye]}>Olho</Text>
          {COLS.map((c) => (
            <Text key={c.key} style={[styles.th, styles.cVal]}>
              {c.label}
            </Text>
          ))}
        </View>
        <EyeRow label="OD (direito)" eye={rx.od} />
        <EyeRow label="OE (esquerdo)" eye={rx.oe} />

        {rx.readingDistance ? (
          <Text style={styles.meta}>Distância de leitura: {rx.readingDistance}</Text>
        ) : null}
        {rx.notes ? <Text style={styles.notes}>Observações: {rx.notes}</Text> : null}

        <Text style={styles.date}>{dateBr}</Text>
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

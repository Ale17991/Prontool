import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { OphthalExam } from './crud'

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
  tplBlock: {
    fontSize: 10,
    color: '#334155',
    marginBottom: 10,
    lineHeight: 1.5,
    textAlign: 'justify',
  },
  tplFooter: { fontSize: 9, color: '#475569', marginTop: 14, lineHeight: 1.4 },
  section: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  trH: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' },
  tr: {
    flexDirection: 'row',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#cbd5e1',
  },
  th: {
    padding: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textAlign: 'center',
    borderRightWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  td: {
    padding: 4,
    fontSize: 9,
    textAlign: 'center',
    borderRightWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  cEye: { width: 90, textAlign: 'left' },
  cVal: { flex: 1 },
  textBlock: { fontSize: 9, color: '#334155', marginTop: 2 },
  date: { marginTop: 20, fontSize: 10, textAlign: 'right' },
  sign: { marginTop: 46, alignItems: 'center' },
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

const d = (v: string | null): string => (v && v.trim() ? v : '—')

export async function renderOphthalExamPdf(
  ex: OphthalExam,
  meta: {
    patientName: string
    clinicProfile?: ClinicProfile | null
    signedLogoUrl?: string | null
    /** Backlog 2/2 — modelo de laudo resolvido (cabeçalho/conclusão/rodapé). */
    template?: {
      title?: string | null
      headerText?: string | null
      conclusionText?: string | null
      footerText?: string | null
    } | null
  },
): Promise<Buffer> {
  const tpl = meta.template ?? null
  const tech = meta.clinicProfile?.techResponsible
  const signName = tech?.name ?? meta.clinicProfile?.displayName ?? ''
  const signReg = [tech?.council, tech?.registration].filter(Boolean).join(' ')
  const dateBr = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ex.examDate)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
  })()

  const element = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={meta.clinicProfile ?? null}
          signedLogoUrl={meta.signedLogoUrl ?? null}
          subtitle="Exame oftalmológico"
        />
        <Text style={styles.title}>{tpl?.title?.trim() || 'Exame oftalmológico'}</Text>
        <Text style={styles.patient}>
          Paciente: {meta.patientName} · Data: {dateBr}
        </Text>

        {tpl?.headerText ? <Text style={styles.tplBlock}>{tpl.headerText}</Text> : null}

        <Text style={styles.section}>Acuidade visual</Text>
        <View style={styles.trH}>
          <Text style={[styles.th, styles.cEye]}>Olho</Text>
          <Text style={[styles.th, styles.cVal]}>Sem correção</Text>
          <Text style={[styles.th, styles.cVal]}>Com correção</Text>
        </View>
        <View style={styles.tr}>
          <Text style={[styles.td, styles.cEye]}>OD (direito)</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.av.odSc)}</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.av.odCc)}</Text>
        </View>
        <View style={styles.tr}>
          <Text style={[styles.td, styles.cEye]}>OE (esquerdo)</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.av.oeSc)}</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.av.oeCc)}</Text>
        </View>

        <Text style={styles.section}>Refração</Text>
        <View style={styles.trH}>
          <Text style={[styles.th, styles.cEye]}>Olho</Text>
          <Text style={[styles.th, styles.cVal]}>Esférico</Text>
          <Text style={[styles.th, styles.cVal]}>Cilíndrico</Text>
          <Text style={[styles.th, styles.cVal]}>Eixo</Text>
        </View>
        <View style={styles.tr}>
          <Text style={[styles.td, styles.cEye]}>OD</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.refr.od.sphere)}</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.refr.od.cylinder)}</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.refr.od.axis)}</Text>
        </View>
        <View style={styles.tr}>
          <Text style={[styles.td, styles.cEye]}>OE</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.refr.oe.sphere)}</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.refr.oe.cylinder)}</Text>
          <Text style={[styles.td, styles.cVal]}>{d(ex.refr.oe.axis)}</Text>
        </View>

        <Text style={styles.section}>Pressão intraocular (mmHg)</Text>
        <Text style={styles.textBlock}>
          OD: {d(ex.pio.od)} OE: {d(ex.pio.oe)}
        </Text>

        {ex.biomicroscopy ? (
          <>
            <Text style={styles.section}>Biomicroscopia</Text>
            <Text style={styles.textBlock}>{ex.biomicroscopy}</Text>
          </>
        ) : null}
        {ex.fundoscopy ? (
          <>
            <Text style={styles.section}>Fundoscopia / mapeamento de retina</Text>
            <Text style={styles.textBlock}>{ex.fundoscopy}</Text>
          </>
        ) : null}
        {ex.notes ? (
          <>
            <Text style={styles.section}>Conduta / observações</Text>
            <Text style={styles.textBlock}>{ex.notes}</Text>
          </>
        ) : null}

        {tpl?.conclusionText ? (
          <>
            <Text style={styles.section}>Conclusão</Text>
            <Text style={styles.tplBlock}>{tpl.conclusionText}</Text>
          </>
        ) : null}

        <Text style={styles.date}>{dateBr}</Text>
        <View style={styles.sign}>
          <Text style={styles.signLine}>
            {signName}
            {signReg ? `\n${signReg}` : ''}
          </Text>
        </View>
        {tpl?.footerText ? <Text style={styles.tplFooter}>{tpl.footerText}</Text> : null}
      </Page>
    </Document>
  )
  return renderToBuffer(element)
}

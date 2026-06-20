/* eslint-disable react/no-unknown-property */
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { ScanRow } from './scan-service'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica', color: '#0f172a', lineHeight: 1.4 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 4 },
  meta: { fontSize: 10, color: '#475569', marginBottom: 2 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 4 },
  cellHead: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#334155' },
  c1: { width: '34%', fontSize: 9 },
  c2: { width: '22%', fontSize: 9 },
  c3: { width: '22%', fontSize: 9 },
  c4: { width: '22%', fontSize: 9 },
  empty: { fontSize: 10, color: '#94a3b8', marginTop: 6 },
  qrWrap: { marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 12 },
  qrImg: { width: 96, height: 96 },
  qrText: { fontSize: 9, color: '#475569', maxWidth: 360 },
  qrUrl: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginTop: 4 },
})

function ddmmyyyy(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export interface SurgicalLabelBundle {
  patientName: string
  appointmentDate: string | null
  scans: ScanRow[]
  verificationUrl: string
  clinicProfile?: ClinicProfile | null
  signedLogoUrl?: string | null
}

export async function renderSurgicalLabelPdf(bundle: SurgicalLabelBundle): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(bundle.verificationUrl, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: 'M',
  })

  const usable = bundle.scans.filter((s) => s.status !== 'rejected')

  const element = (
    <Document>
      <Page size="A5" style={styles.page}>
        <ClinicHeader
          profile={bundle.clinicProfile ?? null}
          signedLogoUrl={bundle.signedLogoUrl ?? null}
          subtitle="Etiqueta de material cirúrgico"
        />
        <Text style={styles.title}>Materiais utilizados</Text>
        <Text style={styles.meta}>Paciente: {bundle.patientName}</Text>
        <Text style={styles.meta}>Data do procedimento: {ddmmyyyy(bundle.appointmentDate)}</Text>

        <Text style={styles.sectionTitle}>Materiais ({usable.length})</Text>
        {usable.length === 0 ? (
          <Text style={styles.empty}>Nenhum material registrado.</Text>
        ) : (
          <View>
            <View style={styles.row}>
              <Text style={[styles.c1, styles.cellHead]}>Fabricante / GTIN</Text>
              <Text style={[styles.c2, styles.cellHead]}>Lote</Text>
              <Text style={[styles.c3, styles.cellHead]}>Validade</Text>
              <Text style={[styles.c4, styles.cellHead]}>Situação</Text>
            </View>
            {usable.map((s) => (
              <View key={s.id} style={styles.row} wrap={false}>
                <Text style={styles.c1}>
                  {s.manufacturer ?? '—'}
                  {s.gtin ? `\n${s.gtin}` : ''}
                </Text>
                <Text style={styles.c2}>{s.lotNumber ?? '—'}</Text>
                <Text style={styles.c3}>{ddmmyyyy(s.expirationDate)}</Text>
                <Text style={styles.c4}>{s.status === 'expired' ? 'VENCIDO' : 'OK'}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.qrWrap}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={qrDataUrl} style={styles.qrImg} />
          <View>
            <Text style={styles.qrText}>
              Aponte a câmera para o código e confirme a autenticidade deste documento. Nenhum dado
              do paciente é exibido na verificação.
            </Text>
            <Text style={styles.qrUrl}>{bundle.verificationUrl}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(element)
}

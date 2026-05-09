import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'

/**
 * PDF de anamnese preenchida. Mesmo padrão do `reports/export-pdf.tsx` —
 * fonte built-in (Helvetica) sem registro externo para manter cold-boot
 * rápido no Vercel e eliminar dependência de rede ao renderizar.
 */
const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10, color: '#334155' },
  header: { marginBottom: 24, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingBottom: 12 },
  tenantName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginTop: 4 },
  patientInfo: { fontSize: 9, color: '#64748b', marginTop: 6 },
  section: { marginBottom: 16 },
  fieldLabel: {
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
    color: '#1e293b',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: {
    padding: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#3b82f6',
    fontSize: 10,
  },
  footer: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 16,
    textAlign: 'center',
  },
  signature: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#94a3b8',
    width: 240,
    alignSelf: 'center',
    textAlign: 'center',
    paddingTop: 6,
  },
  signatureName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  signatureLabel: { fontSize: 8, color: '#64748b' },
})

export interface AnamnesisPdfField {
  id: string
  label: string
  /**
   * Se `true`, o campo é "default" (nome, CPF, plano, alergias etc.) —
   * filtrado da seção de respostas porque os dados já aparecem no
   * cabeçalho do PDF e em outras seções do prontuário. Snapshot fonte
   * continua íntegro; só a exibição é filtrada.
   */
  is_default?: boolean
}

export interface AnamnesisPdfInput {
  tenantName: string
  /** Feature 009 — perfil completo da clínica (logo + dados oficiais). */
  clinicProfile?: ClinicProfile | null
  signedLogoUrl?: string | null
  patientName: string
  templateTitle: string
  templateVersion: number
  fields: AnamnesisPdfField[]
  responses: Record<string, unknown>
  createdAt: string
  professionalName: string
}

function formatPtBrDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function renderAnswer(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Não informado'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

export function AnamnesisPdfDocument(input: AnamnesisPdfInput) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={input.clinicProfile ?? null}
          signedLogoUrl={input.signedLogoUrl ?? null}
          subtitle={`${input.templateTitle} (v${input.templateVersion}) · Paciente: ${input.patientName} · Preenchido em ${formatPtBrDate(input.createdAt)}`}
        />

        {input.fields
          .filter((field) => !field.is_default)
          .map((field) => (
            <View key={field.id} style={styles.section} wrap={false}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <Text style={styles.fieldValue}>
                {renderAnswer(input.responses[field.id])}
              </Text>
            </View>
          ))}

        <View style={styles.footer}>
          <Text style={{ fontSize: 8, color: '#64748b' }}>
            Documento gerado eletronicamente em{' '}
            {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </Text>
          <View style={styles.signature}>
            <Text style={styles.signatureName}>{input.professionalName}</Text>
            <Text style={styles.signatureLabel}>Assinatura do profissional</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}

export async function renderAnamnesisPdf(input: AnamnesisPdfInput): Promise<Buffer> {
  return renderToBuffer(<AnamnesisPdfDocument {...input} />)
}

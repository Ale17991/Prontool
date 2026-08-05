/* eslint-disable react/no-unknown-property */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import {
  PatientBlock,
  PrintFooter,
  brDateTz,
  type PatientHeaderInfo,
} from '@/lib/core/nutrition/printouts/shared'

/**
 * PDF de anamnese preenchida. Mesmo padrão do `reports/export-pdf.tsx` —
 * fonte built-in (Helvetica) sem registro externo para manter cold-boot
 * rápido no Vercel e eliminar dependência de rede ao renderizar.
 *
 * Feature 054 US3: este componente existia sem nenhuma rota que o importasse.
 * Em vez de escrever um décimo componente de PDF, ele foi ligado à rota nova e
 * ganhou o que faltava — rodapé paginado, identificação do paciente em toda
 * página e a regra de que pergunta sem resposta continua aparecendo.
 */
const styles = StyleSheet.create({
  // `paddingBottom` maior que o topo: o rodapé fixo ocupa o pé da página, e sem
  // a folga o texto da última pergunta passaria por cima dele.
  page: { padding: 40, paddingBottom: 60, fontFamily: 'Helvetica', fontSize: 10, color: '#334155' },
  header: {
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 12,
  },
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
  // A lacuna fica visível de propósito: quem recebe o documento precisa
  // enxergar que a pergunta foi feita e não respondida.
  fieldValueMissing: { color: '#94a3b8', borderLeftColor: '#cbd5e1' },
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
  /** Feature 009 — perfil completo da clínica (logo + dados oficiais). */
  clinicProfile?: ClinicProfile | null
  signedLogoUrl?: string | null
  patient: PatientHeaderInfo
  templateTitle: string
  templateVersion: number
  fields: AnamnesisPdfField[]
  responses: Record<string, unknown>
  createdAt: string
  /** Data de emissão do impresso (dia civil da clínica). */
  issuedAt: string
  professionalName: string
}

export interface AnamnesisPrintRow {
  id: string
  label: string
  /** Já pronto para impressão: travessão quando a pergunta ficou sem resposta. */
  answer: string
  /** `true` quando não houve resposta — o chamador pode grifar a lacuna. */
  missing: boolean
}

/**
 * Perguntas e respostas na ordem do modelo, prontas para impressão.
 *
 * **Pergunta sem resposta continua na lista.** Omiti-la produziria um documento
 * que parece completo e esconde que o dado nunca foi coletado — quem lê depois
 * não tem como distinguir "não perguntamos" de "não existia a pergunta". O
 * travessão é a mesma convenção dos outros oito impressos: ausência declarada,
 * nunca ausência disfarçada.
 *
 * Campos `is_default` (nome, CPF, plano, alergias) saem: já estão no cabeçalho
 * do documento e nas seções próprias da ficha.
 */
export function anamnesisPrintRows(
  fields: AnamnesisPdfField[],
  responses: Record<string, unknown>,
): AnamnesisPrintRow[] {
  return fields
    .filter((field) => !field.is_default)
    .map((field) => {
      const value = responses[field.id]
      const missing =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      return {
        id: field.id,
        label: field.label,
        answer: missing ? '—' : renderAnswer(value),
        missing,
      }
    })
}

function renderAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

export function AnamnesisPdfDocument(input: AnamnesisPdfInput) {
  const rows = anamnesisPrintRows(input.fields, input.responses)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader
          profile={input.clinicProfile ?? null}
          signedLogoUrl={input.signedLogoUrl ?? null}
          subtitle={`${input.templateTitle} (v${input.templateVersion}) · Preenchida em ${brDateTz(input.createdAt)}`}
        />

        <PatientBlock patient={input.patient} />

        {rows.length === 0 ? (
          // Modelo só com campos padrão. Dizer isso é melhor que entregar uma
          // folha em branco, que se lê como falha de impressão.
          <Text style={{ fontSize: 9, color: '#64748b' }}>
            Este modelo só tem campos de identificação, já apresentados acima.
          </Text>
        ) : (
          rows.map((row) => (
            <View key={row.id} style={styles.section} wrap={false}>
              <Text style={styles.fieldLabel}>{row.label}</Text>
              <Text style={[styles.fieldValue, row.missing ? styles.fieldValueMissing : {}]}>
                {row.answer}
              </Text>
            </View>
          ))
        )}

        <View style={styles.footer}>
          <View style={styles.signature}>
            <Text style={styles.signatureName}>{input.professionalName}</Text>
            <Text style={styles.signatureLabel}>Assinatura do profissional</Text>
          </View>
        </View>

        <PrintFooter
          professionalName={input.professionalName}
          issuedAt={input.issuedAt}
          patientName={input.patient.name}
        />
      </Page>
    </Document>
  )
}

export async function renderAnamnesisPdf(input: AnamnesisPdfInput): Promise<Buffer> {
  return renderToBuffer(<AnamnesisPdfDocument {...input} />)
}

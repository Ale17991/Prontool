/* eslint-disable react/no-unknown-property */
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import { EvolutionColumns, type EvolutionColumn } from '@/lib/pdf/evolution-columns'
import { DOBRA_PROTOCOLS, TMB_EQUATIONS } from '@/lib/core/nutrition/protocols'
import type { AssessmentForPrint } from '@/lib/core/nutrition/assessments/for-printout'
import { PrintFooter, brDate, dash, printStyles as s } from './shared'
import { PatientIdentityBlock } from '@/lib/pdf/patient-identity-block'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

/**
 * Feature 054 US2 — evolução da avaliação nutricional.
 *
 * O documento existe para responder uma pergunta que um número isolado não
 * responde: "estou melhorando?". Por isso as colunas, e por isso a linha de
 * variação no fim — é o que o paciente procura primeiro quando recebe o papel.
 *
 * Nada é recalculado: cada coluna vem do snapshot imutável da avaliação, com os
 * números do dia em que foi feita. Recalcular com as fórmulas de hoje mudaria o
 * passado, e a revisão de fórmulas de agosto tornou isso concreto.
 */

export interface AssessmentPdfInput {
  clinicProfile: ClinicProfile | null
  identity: PatientIdentity
  professionalName: string
  issuedAt: string
  assessments: AssessmentForPrint[]
}

/** Rótulos das linhas, na ordem em que a profissional lê. */
const LINHAS = [
  'Peso',
  'Estatura',
  'IMC',
  '% de gordura',
  'Massa gorda',
  'Massa magra',
  'Cintura',
  'Quadril',
  'Relação cintura-quadril',
  'TMB',
  'Gasto energético total',
  'Meta calórica',
] as const

function protocolLabel(a: AssessmentForPrint): string {
  const dobra = a.dobraProtocol
    ? (DOBRA_PROTOCOLS[a.dobraProtocol as keyof typeof DOBRA_PROTOCOLS]?.label ?? a.dobraProtocol)
    : null
  const eq = a.tmbEquation
    ? (TMB_EQUATIONS[a.tmbEquation as keyof typeof TMB_EQUATIONS]?.label ?? a.tmbEquation)
    : null
  // O método SEMPRE aparece: dobras e bioimpedância não são comparáveis, e uma
  // coluna sem método faria o leitor tomar troca de instrumento por evolução.
  return [dobra, eq].filter(Boolean).join(' · ') || 'método não informado'
}

export function toColumn(a: AssessmentForPrint): EvolutionColumn {
  const c = a.circumferences ?? {}
  const cell = (label: string, value: string | null, classification?: string | null) => ({
    label,
    value,
    classification: classification ?? null,
  })
  const num = (v: number | null, unit: string) => (v === null ? null : `${dash(v)} ${unit}`)

  return {
    // ISO, não formatada: quem formata é o `EvolutionColumns`, que ordena por
    // este campo. Entregar `01/08/2026` aqui ordenaria as colunas pelo dia.
    assessedAt: a.assessedAt,
    protocol: protocolLabel(a),
    cells: [
      cell('Peso', num(a.weightKg, 'kg')),
      cell('Estatura', num(a.heightCm, 'cm')),
      cell('IMC', a.imc === null ? null : dash(a.imc), a.imcClass),
      cell('% de gordura', a.fatPct === null ? null : `${dash(a.fatPct)}%`),
      cell('Massa gorda', num(a.fatMassKg, 'kg')),
      cell('Massa magra', num(a.leanMassKg, 'kg')),
      cell('Cintura', num(typeof c.cintura === 'number' ? c.cintura : null, 'cm')),
      cell('Quadril', num(typeof c.quadril === 'number' ? c.quadril : null, 'cm')),
      cell(
        'Relação cintura-quadril',
        a.waistHipRatio === null ? null : dash(a.waistHipRatio),
        a.waistHipClass,
      ),
      cell('TMB', num(a.tmbKcal === null ? null : Math.round(a.tmbKcal), 'kcal')),
      cell(
        'Gasto energético total',
        num(a.getKcal === null ? null : Math.round(a.getKcal), 'kcal'),
      ),
      cell('Meta calórica', num(a.targetKcal === null ? null : Math.round(a.targetKcal), 'kcal')),
    ],
  }
}

/** Variação entre a primeira e a última coluna. `null` quando falta uma ponta. */
export function variation(
  first: AssessmentForPrint | undefined,
  last: AssessmentForPrint | undefined,
  pick: (a: AssessmentForPrint) => number | null,
): number | null {
  if (!first || !last || first.id === last.id) return null
  const a = pick(first)
  const b = pick(last)
  if (a === null || b === null) return null
  return Math.round((b - a) * 100) / 100
}

function signed(v: number | null, unit: string): string {
  if (v === null) return '—'
  const sinal = v > 0 ? '+' : ''
  return `${sinal}${dash(v)} ${unit}`
}

export async function renderAssessmentPdf(input: AssessmentPdfInput): Promise<Buffer> {
  const { assessments, identity } = input
  const columns = assessments.map(toColumn)
  const first = assessments[0]
  const last = assessments[assessments.length - 1]

  const dPeso = variation(first, last, (a) => a.weightKg)
  const dGordura = variation(first, last, (a) => a.fatPct)
  const dMagra = variation(first, last, (a) => a.leanMassKg)
  const temVariacao = dPeso !== null || dGordura !== null || dMagra !== null

  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Avaliação nutricional" />
        <PatientIdentityBlock identity={identity} />

        <Text style={s.h2}>Composição corporal e gasto energético</Text>
        <EvolutionColumns columns={columns} labels={LINHAS} />

        {temVariacao ? (
          <View
            style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 6 }}
          >
            {/*
              A pergunta que o paciente faz ao receber o papel é "melhorei?".
              A variação entre a primeira e a última coluna responde direto.
            */}
            <Text style={s.bold}>
              Variação de {brDate(first?.assessedAt)} a {brDate(last?.assessedAt)}
            </Text>
            <Text>
              Peso {signed(dPeso, 'kg')} · Gordura {signed(dGordura, 'p.p.')} · Massa magra{' '}
              {signed(dMagra, 'kg')}
            </Text>
          </View>
        ) : null}

        <Text style={[s.subtle, { marginTop: 12 }]}>
          Cada coluna traz o método usado na data. Resultados obtidos por métodos diferentes não são
          diretamente comparáveis entre si.
        </Text>

        <PrintFooter
          professionalName={input.professionalName}
          issuedAt={input.issuedAt}
          patientName={identity.name}
        />
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

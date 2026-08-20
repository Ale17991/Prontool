/* eslint-disable react/no-unknown-property */
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { LabClass, LabResultItem } from '@/lib/core/labs/classify'
import { LAB_GROUPS } from '@/lib/core/labs/catalog'
import { PrintFooter, brDate, dash, printStyles as s } from './shared'
import { PatientIdentityBlock } from '@/lib/pdf/patient-identity-block'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

/**
 * Feature 054 US4 — quadro de exames laboratoriais.
 *
 * Nada é classificado aqui: o item chega pronto de `classifyLabResults`, o
 * mesmo motor da tela. A regra que este documento precisa proteger é a de
 * FR-011 — **exame sem faixa cadastrada sai sem classificação**. Escrever
 * "normal" onde não há referência é afirmar o que não se sabe, e num papel
 * entregue ao paciente essa afirmação vira tranquilidade infundada.
 */

export interface LabsPdfInput {
  clinicProfile: ClinicProfile | null
  identity: PatientIdentity
  professionalName: string
  issuedAt: string
  items: LabResultItem[]
  /** Quantos analitos ficariam classificáveis se o sexo estivesse no cadastro. */
  blockedBySex?: number
}

/** Rótulo impresso da classificação. Sem referência não recebe rótulo nenhum. */
export function classLabel(c: LabClass): string {
  if (c === 'baixo') return 'Abaixo'
  if (c === 'alto') return 'Acima'
  if (c === 'normal') return 'Dentro da faixa'
  // Não é "normal", não é "alterado": é a ausência de faixa para comparar.
  return '—'
}

/** `12 – 15`, `até 100`, `a partir de 50` ou travessão quando não há faixa. */
export function rangeLabel(refMin: number | null, refMax: number | null): string {
  if (refMin !== null && refMax !== null) return `${dash(refMin)} – ${dash(refMax)}`
  if (refMax !== null) return `até ${dash(refMax)}`
  if (refMin !== null) return `a partir de ${dash(refMin)}`
  return '—'
}

/** Agrupa por painel, na ordem do catálogo. Painel vazio não vira seção. */
export function groupByPanel(
  items: LabResultItem[],
): Array<{ group: string; items: LabResultItem[] }> {
  const known = LAB_GROUPS.filter((g) => items.some((i) => i.group === g))
  const extras = [...new Set(items.map((i) => i.group))].filter((g) => !LAB_GROUPS.includes(g))
  return [...known, ...extras].map((group) => ({
    group,
    items: items.filter((i) => i.group === group),
  }))
}

const COLS = { exame: 3.2, valor: 1.1, unidade: 1, faixa: 1.4, sit: 1.5 }

function Row({ item }: { item: LabResultItem }) {
  const alterado = item.class === 'baixo' || item.class === 'alto'
  return (
    <View style={s.row} wrap={false}>
      <Text style={{ flex: COLS.exame }}>{item.label}</Text>
      <Text style={[{ flex: COLS.valor }, s.right, alterado ? s.bold : {}]}>
        {dash(item.value)}
      </Text>
      <Text style={[{ flex: COLS.unidade }, s.right]}>{item.unit}</Text>
      <Text style={[{ flex: COLS.faixa }, s.right]}>{rangeLabel(item.refMin, item.refMax)}</Text>
      <Text style={[{ flex: COLS.sit }, s.right, alterado ? s.bold : {}]}>
        {classLabel(item.class)}
      </Text>
    </View>
  )
}

export async function renderLabsPdf(input: LabsPdfInput): Promise<Buffer> {
  const { items, identity } = input
  const panels = groupByPanel(items)
  const semReferencia = items.filter((i) => i.class === 'sem_referencia').length
  // A data do exame não é a da emissão: o quadro traz o último resultado de
  // cada analito, e eles podem ser de coletas diferentes.
  const datas = [...new Set(items.map((i) => i.measuredAt))].sort()

  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Exames laboratoriais" />
        <PatientIdentityBlock identity={identity} />

        <Text style={s.subtle}>
          {datas.length === 1
            ? `Coleta de ${brDate(datas[0])}`
            : `Últimos resultados — coletas de ${brDate(datas[0])} a ${brDate(datas[datas.length - 1])}`}
        </Text>

        {panels.map((p) => (
          <View key={p.group} wrap>
            <Text style={s.h2}>{p.group}</Text>
            <View style={s.head} fixed={false}>
              <Text style={[{ flex: COLS.exame }, s.bold]}>Exame</Text>
              <Text style={[{ flex: COLS.valor }, s.bold, s.right]}>Resultado</Text>
              <Text style={[{ flex: COLS.unidade }, s.bold, s.right]}>Unidade</Text>
              <Text style={[{ flex: COLS.faixa }, s.bold, s.right]}>Referência</Text>
              <Text style={[{ flex: COLS.sit }, s.bold, s.right]}>Situação</Text>
            </View>
            {p.items.map((i) => (
              <Row key={i.analyteKey} item={i} />
            ))}
          </View>
        ))}

        {semReferencia > 0 ? (
          <Text style={[s.subtle, { marginTop: 10 }]}>
            {semReferencia === 1 ? '1 exame saiu' : `${semReferencia} exames saíram`} sem situação
            por não haver faixa de referência cadastrada para este paciente
            {input.blockedBySex
              ? ` (${input.blockedBySex} dependem do sexo, que não consta no cadastro)`
              : ''}
            . Isso não significa resultado normal.
          </Text>
        ) : null}

        <Text style={[s.subtle, { marginTop: 6 }]}>
          As faixas de referência variam entre laboratórios. Este quadro não substitui o laudo
          emitido pelo laboratório nem a avaliação do profissional.
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

/* eslint-disable react/no-unknown-property */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { LabelResult } from './compose'
import type { LabelView } from './store'
import { FRONT_OF_PACK_LABEL, type FrontOfPackNutrient } from './reference'
import { formatDeclared } from './rounding'

/**
 * Feature 052 — documento do rótulo para a gráfica.
 *
 * O layout imita a tabela "INFORMAÇÃO NUTRICIONAL" da IN 75/2020 (três colunas:
 * 100 g/mL · porção · %VD), mas isto é um DOCUMENTO DE TRABALHO, não a arte
 * final da embalagem — a norma tem exigências tipográficas (corpo mínimo,
 * contraste, borda) que quem diagrama a embalagem cumpre. Por isso o rodapé de
 * responsabilidade técnica.
 */

export interface LabelPdfInput {
  clinicProfile: ClinicProfile | null
  label: LabelView
  result: LabelResult
}

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 56, fontSize: 9, fontFamily: 'Helvetica', color: '#0f172a' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtle: { color: '#64748b', fontSize: 8 },
  meta: { marginBottom: 10 },
  warnBox: {
    borderWidth: 1.5,
    borderColor: '#b91c1c',
    backgroundColor: '#fef2f2',
    padding: 8,
    marginBottom: 12,
  },
  warnTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#b91c1c', marginBottom: 3 },
  warnText: { fontSize: 8, color: '#7f1d1d', lineHeight: 1.4 },
  tableTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    borderWidth: 1,
    borderColor: '#0f172a',
    padding: 4,
    textAlign: 'center',
  },
  tableBox: { borderWidth: 1, borderTopWidth: 0, borderColor: '#0f172a' },
  head: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  cName: { width: '46%' },
  cNum: { width: '18%', textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    color: '#64748b',
    marginBottom: 3,
  },
  body: { fontSize: 9, lineHeight: 1.4 },
  stampRow: { flexDirection: 'row', marginTop: 12, gap: 6 },
  stamp: {
    borderWidth: 2,
    borderColor: '#0f172a',
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  footer: { marginTop: 16, fontSize: 7, color: '#64748b', lineHeight: 1.4 },
})

function basisLabel(basis: 'solido' | 'liquido'): string {
  return basis === 'liquido' ? '100 mL' : '100 g'
}

function unitSuffix(unit: 'kcal' | 'g' | 'mg'): string {
  return unit === 'kcal' ? ' kcal' : ` ${unit}`
}

export async function renderNutritionLabelPdf(input: LabelPdfInput): Promise<Buffer> {
  const { label, result } = input
  const per = basisLabel(label.basis)
  const portionUnit = label.basis === 'liquido' ? 'mL' : 'g'
  const pending = result.rows.filter((r) => r.state === 'incompleto')
  const applied = (
    Object.entries(result.frontOfPack) as Array<[FrontOfPackNutrient, string]>
  ).filter(([, verdict]) => verdict === 'aplica')
  const inconclusive = (
    Object.entries(result.frontOfPack) as Array<[FrontOfPackNutrient, string]>
  ).filter(([, verdict]) => verdict === 'inconclusivo')

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Rótulo nutricional de produto" />

        <View style={styles.meta}>
          <Text style={styles.title}>{label.productName}</Text>
          {label.clientName ? <Text style={styles.subtle}>Cliente: {label.clientName}</Text> : null}
          <Text style={styles.subtle}>
            Rendimento: {formatDeclared(label.totalYield)} {portionUnit} · Porção:{' '}
            {formatDeclared(label.portionSize)} {portionUnit}
            {label.householdMeasure ? ` (${label.householdMeasure})` : ''}
            {label.portionsPerPackage
              ? ` · ${formatDeclared(label.portionsPerPackage)} porções por embalagem`
              : ''}
          </Text>
          <Text style={styles.subtle}>Referência normativa: {result.normativeVersion}</Text>
        </View>

        {/*
          FR-018: rótulo incompleto NUNCA sai limpo. Sem esta tarja, uma tabela
          com lacunas passa por pronta e vai para a embalagem — que é o dano mais
          caro que este documento pode causar.
        */}
        {result.incomplete ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>RÓTULO INCOMPLETO — NÃO UTILIZÁVEL EM EMBALAGEM</Text>
            <Text style={styles.warnText}>
              Os nutrientes abaixo não puderam ser calculados porque um ou mais ingredientes não têm
              o dado na base. Informe os valores antes de usar este rótulo:{' '}
              {pending.map((r) => r.label).join(', ')}.
            </Text>
          </View>
        ) : null}

        <Text style={styles.tableTitle}>INFORMAÇÃO NUTRICIONAL</Text>
        <View style={styles.tableBox}>
          <View style={styles.head}>
            <Text style={[styles.cName, styles.bold]}>&nbsp;</Text>
            <Text style={[styles.cNum, styles.bold]}>{per}</Text>
            <Text style={[styles.cNum, styles.bold]}>
              {formatDeclared(label.portionSize)} {portionUnit}
            </Text>
            <Text style={[styles.cNum, styles.bold]}>%VD*</Text>
          </View>
          {result.rows.map((r) => (
            <View style={styles.row} key={r.key}>
              <Text style={styles.cName}>
                {r.label}
                {r.state === 'sobrescrito' ? ' †' : ''}
              </Text>
              <Text style={styles.cNum}>
                {r.per100 === null ? '—' : `${formatDeclared(r.per100)}${unitSuffix(r.unit)}`}
              </Text>
              <Text style={styles.cNum}>
                {r.perPortion === null
                  ? '—'
                  : `${formatDeclared(r.perPortion)}${unitSuffix(r.unit)}`}
              </Text>
              <Text style={styles.cNum}>
                {r.dvPercent === null ? '—' : `${formatDeclared(r.dvPercent)}%`}
              </Text>
            </View>
          ))}
        </View>
        <Text style={[styles.subtle, { marginTop: 3 }]}>
          * Percentual de valores diários fornecidos pela porção. † Valor informado manualmente.
        </Text>

        {applied.length > 0 ? (
          <View style={styles.stampRow}>
            {applied.map(([key]) => (
              <Text style={styles.stamp} key={key}>
                {FRONT_OF_PACK_LABEL[key]}
              </Text>
            ))}
          </View>
        ) : null}

        {inconclusive.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rotulagem frontal — pendente</Text>
            <Text style={styles.body}>
              Não foi possível concluir sobre{' '}
              {inconclusive
                .map(([key]) => FRONT_OF_PACK_LABEL[key].replace('ALTO EM ', '').toLowerCase())
                .join(', ')}{' '}
              por falta de dado. Isto não significa que a marca frontal seja dispensada.
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ingredientes</Text>
          <Text style={styles.body}>
            {label.ingredientsText ||
              label.ingredients.map((i) => `${i.name} (${formatDeclared(i.grams)} g)`).join(', ')}
          </Text>
        </View>

        {label.allergensText ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Alérgicos</Text>
            <Text style={[styles.body, styles.bold]}>{label.allergensText}</Text>
          </View>
        ) : null}

        {label.storageText ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Conservação</Text>
            <Text style={styles.body}>{label.storageText}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          Documento de trabalho gerado a partir da composição informada. A responsabilidade técnica
          pelo rótulo, pela conferência dos dados dos ingredientes e pela conformidade da arte final
          da embalagem é do profissional responsável.
        </Text>
      </Page>
    </Document>
  )
  return renderToBuffer(doc)
}

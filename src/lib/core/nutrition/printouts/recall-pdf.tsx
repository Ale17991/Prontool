/* eslint-disable react/no-unknown-property */
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { AdequacyResult } from '@/lib/core/nutrition/adequacy'
import type { RecallView } from '@/lib/core/nutrition/recall/plan'
import {
  PatientBlock,
  PrintFooter,
  brDate,
  dash,
  fmt,
  printStyles as s,
  type PatientHeaderInfo,
} from './shared'

/**
 * Feature 054 US4 — recordatório alimentar de 24 horas.
 *
 * É o oposto do plano: registra o que o paciente **comeu**, não o que deve
 * comer. Por isso não leva tarja de prescrição nem meta por refeição — o
 * documento é um retrato, e sugerir que ele prescreve inverteria o sentido.
 *
 * Os totais vêm prontos de `getRecall`, o mesmo caminho da tela. Somar de novo
 * aqui é o que o teste T027 existe para impedir.
 */

export interface RecallPdfInput {
  clinicProfile: ClinicProfile | null
  patient: PatientHeaderInfo
  professionalName: string
  issuedAt: string
  recall: RecallView
  /** Micronutrientes × DRI. Ausente quando falta idade ou sexo no cadastro. */
  adequacy?: AdequacyResult | null
}

/**
 * Os números que a linha de total imprime.
 *
 * Existe para o teste poder comparar o impresso com o que a tela mostra sem
 * abrir o PDF. Repare que ele só arredonda o que `getRecall` já somou: se um dia
 * alguém somar de novo aqui, o teste que compara com o motor da tela quebra.
 */
export function printedTotals(recall: RecallView): Record<string, number> {
  const t = recall.totals
  return {
    energyKcal: Math.round(t.energyKcal),
    proteinG: Math.round(t.proteinG),
    carbG: Math.round(t.carbG),
    fatG: Math.round(t.fatG),
    fiberG: Math.round(t.fiberG),
  }
}

const ADEQUACY_LABEL: Record<string, string> = {
  abaixo: 'Abaixo',
  adequado: 'Adequado',
  acima: 'Acima',
  sem_referencia: '—',
}

export async function renderRecallPdf(input: RecallPdfInput): Promise<Buffer> {
  const { recall, patient, adequacy } = input
  const t = printedTotals(recall)
  // Só o que tem referência entra no quadro: listar "—" para dezenas de micros
  // sem DRI encheria a página de linhas que não informam nada.
  const adequacyItems = (adequacy?.items ?? []).filter((i) => i.class !== 'sem_referencia')

  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Recordatório alimentar (24h)" />
        <PatientBlock patient={patient} />

        <Text style={s.subtle}>Consumo referente a {brDate(recall.recallDate)}</Text>

        {recall.meals.map((meal, idx) => (
          <View key={`${meal.name}-${idx}`} style={{ marginTop: 10 }} wrap={false}>
            <View style={s.head}>
              <Text style={[{ width: '62%' }, s.bold]}>{meal.name}</Text>
              <Text style={[{ width: '19%' }, s.right, s.subtle]}>quantidade</Text>
              <Text style={[{ width: '19%' }, s.right, s.subtle]}>medida caseira</Text>
            </View>

            {meal.items.map((item, i) => (
              <View key={`${item.foodId}-${i}`} style={s.row} wrap={false}>
                <Text style={{ width: '62%' }}>{item.name}</Text>
                {/*
                  Item sem gramas informadas não entra na conta e sai com
                  travessão. Imprimir "0 g" faria o total parecer completo
                  quando na verdade um alimento ficou de fora dele.
                */}
                <Text style={{ width: '19%', textAlign: 'right' }}>{fmt(item.grams, 'g')}</Text>
                <Text style={{ width: '19%', textAlign: 'right', color: '#64748b' }}>
                  {item.measureLabel
                    ? `${item.measureQty ? `${dash(item.measureQty)} ` : ''}${item.measureLabel}`
                    : '—'}
                </Text>
              </View>
            ))}

            <Text style={[s.subtle, { marginTop: 2 }]}>
              {fmt(Math.round(meal.totals.energyKcal), 'kcal')} · P{' '}
              {fmt(Math.round(meal.totals.proteinG), 'g')} · C{' '}
              {fmt(Math.round(meal.totals.carbG), 'g')} · G{' '}
              {fmt(Math.round(meal.totals.fatG), 'g')}
            </Text>
          </View>
        ))}

        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 6 }}>
          <Text style={s.bold}>Total do dia</Text>
          <Text>
            {fmt(t.energyKcal, 'kcal')} · Proteína {fmt(t.proteinG, 'g')} · Carboidrato{' '}
            {fmt(t.carbG, 'g')} · Gordura {fmt(t.fatG, 'g')} · Fibra {fmt(t.fiberG, 'g')}
          </Text>
        </View>

        {adequacyItems.length > 0 ? (
          <View style={{ marginTop: 12 }} wrap>
            <Text style={s.h2}>Adequação de micronutrientes</Text>
            <View style={s.head}>
              <Text style={[{ flex: 3 }, s.bold]}>Nutriente</Text>
              <Text style={[{ flex: 1.3 }, s.bold, s.right]}>Consumido</Text>
              <Text style={[{ flex: 1.3 }, s.bold, s.right]}>Recomendado</Text>
              <Text style={[{ flex: 1 }, s.bold, s.right]}>%</Text>
              <Text style={[{ flex: 1.4 }, s.bold, s.right]}>Situação</Text>
            </View>
            {adequacyItems.map((a) => (
              <View key={a.nutrientKey} style={s.row} wrap={false}>
                <Text style={{ flex: 3 }}>{a.label}</Text>
                <Text style={[{ flex: 1.3 }, s.right]}>{fmt(a.total, a.unit)}</Text>
                <Text style={[{ flex: 1.3 }, s.right]}>{fmt(a.dri, a.unit)}</Text>
                <Text style={[{ flex: 1 }, s.right]}>{a.pct === null ? '—' : `${dash(a.pct)}%`}</Text>
                <Text style={[{ flex: 1.4 }, s.right, a.class === 'adequado' ? {} : s.bold]}>
                  {ADEQUACY_LABEL[a.class] ?? '—'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {recall.notes ? (
          <View style={{ marginTop: 12 }}>
            <Text style={s.h2}>Observações</Text>
            <Text>{recall.notes}</Text>
          </View>
        ) : null}

        <Text style={[s.subtle, { marginTop: 10 }]}>
          Registro do consumo relatado pelo paciente. Não é uma prescrição alimentar.
        </Text>

        <PrintFooter
          professionalName={input.professionalName}
          issuedAt={input.issuedAt}
          patientName={patient.name}
        />
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

/* eslint-disable react/no-unknown-property */
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { DietPlanView } from '@/lib/core/nutrition/diet/plan'
import {
  DraftStamp,
  PatientBlock,
  PrintFooter,
  brDate,
  dash,
  fmt,
  printStyles as s,
  type PatientHeaderInfo,
} from './shared'

/**
 * Feature 054 US1 — plano alimentar impresso.
 *
 * É o documento que o paciente mais usa: vai para a geladeira e para o mercado.
 * Por isso a hierarquia visual privilegia "o que comer e quanto", e deixa o
 * total de macros como rodapé da refeição, não como protagonista — quem lê não
 * é nutricionista.
 *
 * **Este componente não calcula nada.** Recebe o `DietPlanView` já montado pelo
 * mesmo caminho que alimenta a tela. Recalcular aqui reintroduziria, pela porta
 * da impressão, a divergência entre papel e tela que a revisão de fórmulas
 * acabou de eliminar.
 */

export interface PlanPdfInput {
  clinicProfile: ClinicProfile | null
  patient: PatientHeaderInfo
  professionalName: string
  issuedAt: string
  plan: DietPlanView
}

function MealItem({
  name,
  grams,
  measure,
}: {
  name: string
  grams: number | null
  measure: string | null
}) {
  return (
    <View style={s.row} wrap={false}>
      <Text style={{ width: '62%' }}>{name}</Text>
      <Text style={{ width: '19%', textAlign: 'right' }}>{fmt(grams, 'g')}</Text>
      <Text style={{ width: '19%', textAlign: 'right', color: '#64748b' }}>{dash(measure)}</Text>
    </View>
  )
}

export async function renderPlanPdf(input: PlanPdfInput): Promise<Buffer> {
  const { plan, patient } = input
  const t = plan.totals

  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Plano alimentar" />
        <PatientBlock patient={patient} />

        {/* FR-010: rascunho não pode circular como prescrição fechada. */}
        {plan.status === 'rascunho' ? <DraftStamp /> : null}

        <Text style={s.subtle}>
          {plan.title}
          {plan.target?.assessedAt ? ` · meta da avaliação de ${brDate(plan.target.assessedAt)}` : ''}
        </Text>

        {plan.meals.map((meal) => (
          <View key={meal.id} style={{ marginTop: 10 }} wrap={false}>
            <View style={s.head}>
              <Text style={[{ width: '62%' }, s.bold]}>
                {meal.name}
                {meal.timeLabel ? ` · ${meal.timeLabel}` : ''}
              </Text>
              <Text style={[{ width: '19%' }, s.right, s.subtle]}>quantidade</Text>
              <Text style={[{ width: '19%' }, s.right, s.subtle]}>medida caseira</Text>
            </View>

            {meal.items.map((item) =>
              item.isGroup ? (
                <View key={item.id} style={{ paddingVertical: 3 }} wrap={false}>
                  <Text style={s.bold}>{item.name}</Text>
                  {/*
                    FR-009: as opções de um grupo são ALTERNATIVAS. Listá-las
                    como itens faria o paciente entender que deve comer todas —
                    e a energia do grupo conta uma vez só no total.
                  */}
                  <Text style={{ fontSize: 8.5, color: '#475569', marginTop: 1 }}>
                    escolha uma:{' '}
                    {(item.groupOptions ?? [])
                      .map((o) => `${o.name} (${dash(o.grams)} g)`)
                      .join('  ou  ')}
                  </Text>
                </View>
              ) : (
                <MealItem
                  key={item.id}
                  name={item.name}
                  grams={item.grams}
                  measure={
                    item.measureLabel
                      ? `${item.measureQty ? `${dash(item.measureQty)} ` : ''}${item.measureLabel}`
                      : null
                  }
                />
              ),
            )}

            <Text style={[s.subtle, { marginTop: 2 }]}>
              {fmt(Math.round(meal.totals.energyKcal), 'kcal')} · P{' '}
              {fmt(Math.round(meal.totals.proteinG), 'g')} · C{' '}
              {fmt(Math.round(meal.totals.carbG), 'g')} · G{' '}
              {fmt(Math.round(meal.totals.fatG), 'g')}
              {meal.targetPct !== null ? ` · meta ${dash(meal.targetPct)}% do dia` : ''}
            </Text>
          </View>
        ))}

        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 6 }}>
          <Text style={s.bold}>Total do dia</Text>
          <Text>
            {fmt(Math.round(t.energyKcal), 'kcal')} · Proteína{' '}
            {fmt(Math.round(t.proteinG), 'g')} · Carboidrato {fmt(Math.round(t.carbG), 'g')} ·
            Gordura {fmt(Math.round(t.fatG), 'g')} · Fibra {fmt(Math.round(t.fiberG), 'g')}
          </Text>
          {plan.target ? (
            <Text style={s.subtle}>
              Meta: {fmt(Math.round(plan.target.kcal), 'kcal')}
              {plan.target.macros
                ? ` · P ${fmt(plan.target.macros.protG, 'g')} · C ${fmt(plan.target.macros.carbG, 'g')} · G ${fmt(plan.target.macros.fatG, 'g')}`
                : ''}
            </Text>
          ) : null}
        </View>

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

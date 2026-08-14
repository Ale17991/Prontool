/**
 * Feature 057 — /paciente/[slug]/painel/evolucao — seção "Minha evolução".
 *
 * Resumo dos indicadores atuais, um GRÁFICO POR PARÂMETRO medido e a linha do
 * tempo das medições.
 *
 * Os gráficos (`WeightImcChart`, `MetricEvolutionChart`) existem desde a 030 e
 * nunca tinham sido usados aqui: o portal mostrava número e tendência em texto,
 * numa seção que promete evolução. Evolução se lê no formato, não na tabela —
 * a subida e a queda aparecem antes de qualquer número.
 *
 * Nenhuma faixa de referência é desenhada. O catálogo tem `min_plausible` e
 * `max_plausible`, mas são anti-typo (folgados ~10x), NÃO faixa clínica; pintar
 * uma banda com eles diria ao paciente que ele está "dentro do normal" onde
 * ninguém afirmou isso. Resultado com interpretação é a seção de exames.
 *
 * Monta o bundle completo de propósito: é ele que decide se os analitos de
 * laboratório saem daqui (quando a seção de exames está exibindo os mesmos
 * valores) — regra da 050 que não pode ser reimplementada em pedaços, sob pena
 * de o exame voltar a aparecer em dois lugares.
 */

import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { DashboardSummary } from '@/components/patient-portal/dashboard-summary'
import {
  MetricEvolutionChart,
  WeightImcChart,
} from '@/components/patient-portal/evolution-chart'
import { PatientTimeline } from '@/components/patient-portal/patient-timeline'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

/** Mesmo rótulo usado no resumo e na linha do tempo. */
const METRIC_LABEL_OVERRIDE: Record<string, string> = { glicemia_jejum: 'Glicemia em jejum' }

export default async function PortalEvolucaoPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'metricas',
  })

  const bundle = await buildPatientPortalBundle(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })

  const hasWeightImc = bundle.weightImc.some((p) => p.weightKg !== null || p.bmi !== null)
  // Só entra gráfico de métrica que tem pelo menos um ponto: eixo vazio não é
  // "ainda não medimos", é uma caixa que parece defeito.
  const charts = bundle.metricTypes
    .map((t) => ({
      key: t.metricType,
      label: METRIC_LABEL_OVERRIDE[t.metricType] ?? t.label,
      unit: t.unit,
      points: (bundle.metrics[t.metricType] ?? []).map((m) => ({
        date: m.measuredAt,
        value: m.value,
      })),
    }))
    .filter((c) => c.points.length > 0)

  const hasData = hasWeightImc || charts.length > 0

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Minha evolução"
        subtitle="Seus indicadores e como eles vêm mudando."
        backHref={`/paciente/${slug}/painel`}
      />

      {hasData ? (
        <>
          <DashboardSummary
            weightImc={bundle.weightImc}
            metrics={bundle.metrics}
            metricTypes={bundle.metricTypes}
          />

          {hasWeightImc ? <WeightImcChart points={bundle.weightImc} /> : null}

          {charts.length > 0 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {charts.map((c) => (
                <MetricEvolutionChart
                  key={c.key}
                  label={c.label}
                  unit={c.unit}
                  points={c.points}
                />
              ))}
            </div>
          ) : null}

          <PatientTimeline
            appointments={[]}
            weightImc={bundle.weightImc}
            metrics={bundle.metrics}
            metricTypes={bundle.metricTypes}
            careNotes={[]}
          />
        </>
      ) : (
        <PortalEmpty>
          Suas medições aparecem aqui assim que a equipe registrar os dados da consulta.
        </PortalEmpty>
      )}
    </div>
  )
}

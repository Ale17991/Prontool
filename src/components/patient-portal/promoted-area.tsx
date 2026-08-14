import type { PortalSectionKey } from '@/lib/core/patient-portal/sections'
import type { PatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import type { PortalChartColors } from '@/lib/core/patient-portal/theme'
import { DashboardSummary } from './dashboard-summary'
import { PatientTimeline } from './patient-timeline'
import { LabResultsCard } from './lab-results-card'
import { BodyCompositionCard } from './body-composition-card'
import { WorkoutCard, DietCard } from './plan-cards'

/**
 * Feature 057 — a área que sobe ABERTA para a tela inicial quando o paciente
 * não tem metas nem checklist.
 *
 * Sem isso, quem não tem meta nem hábito veria uma tela inicial só de cards —
 * um menu, não um acompanhamento. Promove-se a primeira área COM CONTEÚDO na
 * ordem do catálogo, e ela sai da grade de cards logo abaixo: a mesma coisa não
 * se mostra duas vezes.
 *
 * Renderiza exatamente os mesmos componentes da página da área. Reimplementar
 * uma versão "resumida" criaria duas verdades sobre o mesmo dado, que é a
 * classe de divergência que a 054 gastou uma feature inteira eliminando entre
 * papel e tela.
 */
export function PromotedArea({
  section,
  bundle,
  palette,
}: {
  section: PortalSectionKey
  bundle: PatientPortalBundle
  /** Cores da clínica já resolvidas em hex, para o que é desenhado em SVG. */
  palette?: PortalChartColors | null
}) {
  switch (section) {
    case 'atendimentos':
      return (
        <PatientTimeline
          appointments={bundle.appointments}
          weightImc={[]}
          metrics={{}}
          metricTypes={[]}
          careNotes={[]}
        />
      )
    case 'metricas':
      return (
        <div className="space-y-6">
          <DashboardSummary
            weightImc={bundle.weightImc}
            metrics={bundle.metrics}
            metricTypes={bundle.metricTypes}
          />
          <PatientTimeline
            appointments={[]}
            weightImc={bundle.weightImc}
            metrics={bundle.metrics}
            metricTypes={bundle.metricTypes}
            careNotes={[]}
          />
        </div>
      )
    case 'orientacoes':
      return (
        <PatientTimeline
          appointments={[]}
          weightImc={[]}
          metrics={{}}
          metricTypes={[]}
          careNotes={bundle.careNotes}
        />
      )
    case 'composicao':
      return bundle.bodyComposition?.latest ? (
        <BodyCompositionCard view={bundle.bodyComposition} palette={palette} />
      ) : null
    case 'exames':
      return <LabResultsCard items={bundle.labResults ?? []} />
    case 'treino':
      return bundle.workout ? <WorkoutCard plan={bundle.workout} /> : null
    case 'dieta':
      return bundle.diet ? <DietCard plan={bundle.diet} /> : null
    default:
      // Seções sem render próprio (metas e hábitos moram na home; as demais do
      // catálogo ainda não existem) nunca chegam aqui: só entra na promoção o
      // que a home apurou como "tem conteúdo".
      return null
  }
}

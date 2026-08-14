/**
 * Feature 030/032/057 — /paciente/[slug]/painel — home do portal do paciente.
 *
 * Server component SÓ-LEITURA. Sessão, gate de seção e trilha LGPD ficam em
 * `openPortalPage`; o QUE a tela mostra fica em `buildPortalHome` — regra dentro
 * de JSX não se testa sem renderizar página.
 *
 * A home mostra APENAS o que o paciente acompanha no dia a dia: metas e o
 * checklist de hábitos, a única coisa que ele de fato FAZ aqui. O resto virou
 * card que leva à página da área. Quando nem metas nem checklist têm o que
 * exibir, a tela se preenche com o recado da clínica e a primeira área com
 * conteúdo, aberta.
 *
 * O bundle inteiro é montado aqui de propósito: alimenta a prévia de cada card e
 * o conteúdo da área promovida. As páginas de seção buscam só a sua fatia.
 */

import {
  Activity,
  Beaker,
  CalendarDays,
  ClipboardList,
  Dumbbell,
  PieChart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { todayInClinicTz } from '@/lib/core/patient-portal/format'
import { buildPortalHome } from '@/lib/core/patient-portal/home-layout'
import { getActiveChecklist } from '@/lib/core/habits/store'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { GoalsCard } from '@/components/patient-portal/goals-card'
import { HabitsCard } from '@/components/patient-portal/habits-card'
import { PromotedArea } from '@/components/patient-portal/promoted-area'
import { PortalSectionCards, type PortalCard } from '@/components/patient-portal/section-cards'
import { PatientLogoutButton } from './logout-button'

export const dynamic = 'force-dynamic'

/**
 * Ícone de cada área. É do componente, não da regra — por isso vive só aqui.
 *
 * Feature 058: cada área tinha um pastel próprio (esmeralda, violeta, âmbar…),
 * escrito na mão. Isso caiu por dois motivos que apontam para o mesmo lugar.
 * Cor fixa em classe é invisível para qualquer tema, então a clínica que
 * escolhesse a própria paleta veria seis pastéis alheios no meio dela. E o
 * FR-002 diz onde a cor da marca deve aparecer: ações, ÍCONES DE SEÇÃO e
 * indicadores. O que distingue uma área da outra passa a ser o desenho do
 * ícone, que é o que a pessoa de fato lê num quadrado de 40px.
 */
const AREA_ICON: Record<string, LucideIcon> = {
  atendimentos: CalendarDays,
  metricas: Activity,
  composicao: PieChart,
  orientacoes: ClipboardList,
  exames: Beaker,
  treino: Dumbbell,
  dieta: UtensilsCrossed,
}

export default async function PacientePainelPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, enabled, slug, theme } = await openPortalPage(params.slug)

  const [bundle, checklist] = await Promise.all([
    buildPatientPortalBundle(supabase, {
      tenantId: session.tenantId,
      patientId: session.patientId,
    }),
    // A promoção precisa saber se existe checklist ANTES de a tela se desenhar.
    // O `HabitsCard` descobre isso pelo cliente, tarde demais para o layout — e
    // a resposta sempre esteve disponível aqui no servidor.
    enabled.has('habitos')
      ? getActiveChecklist(supabase, session.tenantId, session.patientId)
      : Promise.resolve(null),
  ])

  const home = buildPortalHome({
    enabled,
    bundle,
    hasChecklist: checklist !== null,
    welcomeText: clinic.welcomeText,
  })

  const cards: PortalCard[] = home.cards.map((c) => ({
    key: c.key,
    label: c.label,
    href: `/paciente/${slug}/painel/${c.path}`,
    hint: c.hint,
    empty: c.empty,
    emptyHint: c.emptyHint,
    icon: AREA_ICON[c.key] ?? Activity,
  }))

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title={bundle.patient.firstName ? `Olá, ${bundle.patient.firstName}` : 'Olá'}
        subtitle="Acompanhe sua evolução de saúde."
        right={<PatientLogoutButton slug={slug} />}
        nextAppointment={home.nextAppointment}
      />

      {home.showWelcome ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {clinic.welcomeText}
          </p>
        </section>
      ) : null}

      {home.showGoals ? (
        <GoalsCard
          goals={bundle.goals}
          weightImc={bundle.weightImc}
          metrics={bundle.metrics}
          metricTypes={bundle.metricTypes}
        />
      ) : null}

      {home.showHabitos ? <HabitsCard today={todayInClinicTz()} /> : null}

      {home.promoted ? (
        <PromotedArea section={home.promoted} bundle={bundle} palette={theme?.chart} />
      ) : null}

      <PortalSectionCards cards={cards} />

      {home.hasAnything ? null : (
        <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Ainda não há informações para exibir. Assim que a equipe da clínica registrar seus dados,
          eles aparecem aqui.
        </p>
      )}

      <footer className="text-center text-xs text-muted-foreground">
        <p>Sessão de 30 minutos de inatividade. Cada acesso é registrado por segurança (LGPD).</p>
      </footer>
    </div>
  )
}

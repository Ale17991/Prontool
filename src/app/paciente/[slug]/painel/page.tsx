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

/** Ícone e cor são do componente, não da regra — por isso vivem só aqui. */
const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  atendimentos: { icon: CalendarDays, tone: 'bg-emerald-100 text-emerald-700' },
  metricas: { icon: Activity, tone: 'bg-violet-100 text-violet-700' },
  orientacoes: { icon: ClipboardList, tone: 'bg-amber-100 text-amber-700' },
  exames: { icon: Beaker, tone: 'bg-sky-100 text-sky-700' },
  treino: { icon: Dumbbell, tone: 'bg-indigo-100 text-indigo-700' },
  dieta: { icon: UtensilsCrossed, tone: 'bg-lime-100 text-lime-700' },
}

export default async function PacientePainelPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, enabled, slug } = await openPortalPage(params.slug)

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
    icon: LOOK[c.key]?.icon ?? Activity,
    tone: LOOK[c.key]?.tone ?? 'bg-slate-100 text-slate-600',
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
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
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

      {home.promoted ? <PromotedArea section={home.promoted} bundle={bundle} /> : null}

      <PortalSectionCards cards={cards} />

      {home.hasAnything ? null : (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Ainda não há informações para exibir. Assim que a equipe da clínica registrar seus dados,
          eles aparecem aqui.
        </p>
      )}

      <footer className="text-center text-xs text-slate-400">
        <p>Sessão de 30 minutos de inatividade. Cada acesso é registrado por segurança (LGPD).</p>
      </footer>
    </div>
  )
}

/**
 * Feature 030/032 — /paciente/[slug]/painel — portal do paciente.
 *
 * Server component SÓ-LEITURA. Exige sessão de paciente válida E da clínica do
 * slug — senão volta ao login. Identidade vem só do cookie HMAC; o bundle
 * filtra tudo por patient_id+tenant_id da sessão. Cada render registra `view`.
 *
 * Feature 032: visual em LINHA DO TEMPO; cada seção só entra se a clínica a
 * habilitou (`listEnabledPortalSections`).
 */

import { notFound, redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolvePortalClinicBySlug } from '@/lib/core/patient-portal/login'
import {
  PATIENT_SESSION_COOKIE_NAME,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'
import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { listEnabledPortalSections } from '@/lib/core/patient-portal/sections'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { hashIpForPatientPortal, logPatientAccess } from '@/lib/core/patient-portal/audit'
import { Card, CardContent } from '@/components/ui/card'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { PatientTimeline } from '@/components/patient-portal/patient-timeline'
import { GoalsCard } from '@/components/patient-portal/goals-card'
import { DashboardSummary } from '@/components/patient-portal/dashboard-summary'
import { WorkoutCard, DietCard } from '@/components/patient-portal/plan-cards'
import { PatientLogoutButton } from './logout-button'

export const dynamic = 'force-dynamic'

export default async function PacientePainelPage({ params }: { params: { slug: string } }) {
  const supabase = createSupabaseServiceClient()
  const clinic = await resolvePortalClinicBySlug(supabase, params.slug)
  if (!clinic) notFound()

  const rawCookie = cookies().get(PATIENT_SESSION_COOKIE_NAME)?.value
  const session = verifyPatientSessionCookie(rawCookie)
  if (!session || session.tenantId !== clinic.tenantId) {
    redirect(`/paciente/${params.slug}${rawCookie ? '?sessao=expirada' : ''}`)
  }

  const ent = await getTenantEntitlements(supabase, session.tenantId)
  const [bundle, enabledList] = await Promise.all([
    buildPatientPortalBundle(supabase, {
      tenantId: session.tenantId,
      patientId: session.patientId,
    }),
    listEnabledPortalSections(supabase, session.tenantId, { hasModule: (m) => ent.hasModule(m) }),
  ])
  const enabled = new Set(enabledList)
  const showMetas = enabled.has('metas')
  const showMetricas = enabled.has('metricas')
  const showAtendimentos = enabled.has('atendimentos')
  const showOrientacoes = enabled.has('orientacoes')
  const showTreino = enabled.has('treino')
  const showDieta = enabled.has('dieta')

  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
  await logPatientAccess({
    supabase,
    tenantId: session.tenantId,
    patientId: session.patientId,
    action: 'view',
    ipHash: hashIpForPatientPortal(ip, session.tenantId),
    userAgent: h.get('user-agent'),
  })

  const hasAnyMetric = Object.values(bundle.metrics).some((s) => s.length > 0)
  const hasMetricData = bundle.weightImc.length > 0 || hasAnyMetric
  const showDashboard = showMetricas && hasMetricData
  const showGoals = showMetas && bundle.goals.length > 0
  const timelineHasContent =
    (showMetricas && hasMetricData) ||
    (showAtendimentos && bundle.appointments.length > 0) ||
    (showOrientacoes && bundle.careNotes.length > 0)
  const treinoCol = showTreino
  const dietaCol = showDieta

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title={bundle.patient.firstName ? `Olá, ${bundle.patient.firstName}` : 'Olá'}
        subtitle="Acompanhe sua evolução de saúde."
        right={<PatientLogoutButton slug={params.slug} />}
      />

      {/* Dashboard (primeira impressão) + metas, largura total */}
      {showDashboard ? (
        <DashboardSummary
          weightImc={bundle.weightImc}
          metrics={bundle.metrics}
          metricTypes={bundle.metricTypes}
        />
      ) : null}

      {showGoals ? (
        <GoalsCard
          goals={bundle.goals}
          weightImc={bundle.weightImc}
          metrics={bundle.metrics}
          metricTypes={bundle.metricTypes}
        />
      ) : null}

      {/* 3 colunas no desktop: Treino | Linha do tempo | Dieta (timeline 1º no mobile) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)]">
        {treinoCol ? (
          <div className="order-2 lg:order-1 lg:col-start-1">
            {bundle.workout ? (
              <WorkoutCard plan={bundle.workout} />
            ) : (
              <PlanPlaceholder kind="treino" />
            )}
          </div>
        ) : null}

        <div className="order-1 lg:order-2 lg:col-start-2">
          {timelineHasContent ? (
            <PatientTimeline
              appointments={showAtendimentos ? bundle.appointments : []}
              weightImc={showMetricas ? bundle.weightImc : []}
              metrics={showMetricas ? bundle.metrics : {}}
              metricTypes={showMetricas ? bundle.metricTypes : []}
              careNotes={showOrientacoes ? bundle.careNotes : []}
            />
          ) : (
            <Card className="rounded-2xl border-slate-200">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                Ainda não há informações para exibir. Assim que a equipe da clínica registrar seus
                dados, eles aparecem aqui.
              </CardContent>
            </Card>
          )}
        </div>

        {dietaCol ? (
          <div className="order-3 lg:col-start-3">
            {bundle.diet ? <DietCard plan={bundle.diet} /> : <PlanPlaceholder kind="dieta" />}
          </div>
        ) : null}
      </div>

      <footer className="text-center text-xs text-slate-400">
        <p>Sessão de 30 minutos. Cada acesso é registrado por segurança (LGPD).</p>
      </footer>
    </div>
  )
}

function PlanPlaceholder({ kind }: { kind: 'treino' | 'dieta' }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-center text-sm text-slate-400">
      {kind === 'treino'
        ? 'Seu profissional ainda não cadastrou sua rotina de treino.'
        : 'Seu nutricionista ainda não cadastrou seu plano alimentar.'}
    </section>
  )
}

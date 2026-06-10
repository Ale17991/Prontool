/**
 * Feature 030/032 — /paciente/[slug]/painel — portal do paciente.
 *
 * Server component SÓ-LEITURA (FR-004/FR-006). Exige sessão de paciente
 * válida E da clínica do slug — senão volta ao login. A identidade vem
 * exclusivamente do cookie HMAC verificado; o bundle filtra tudo por
 * patient_id+tenant_id da sessão. Cada render registra `view` (FR-020).
 *
 * Feature 032: cada seção só renderiza se a clínica a habilitou
 * (`listEnabledPortalSections`) — portal modular/configurável.
 */

import { notFound, redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { CalendarDays, ClipboardList, LineChart } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolvePortalClinicBySlug } from '@/lib/core/patient-portal/login'
import {
  PATIENT_SESSION_COOKIE_NAME,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'
import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { listEnabledPortalSections } from '@/lib/core/patient-portal/sections'
import {
  hashIpForPatientPortal,
  logPatientAccess,
} from '@/lib/core/patient-portal/audit'
import {
  MetricEvolutionChart,
  WeightImcChart,
} from '@/components/patient-portal/evolution-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { PatientLogoutButton } from './logout-button'

export const dynamic = 'force-dynamic'

function formatDateTimePtBr(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export default async function PacientePainelPage({
  params,
}: {
  params: { slug: string }
}) {
  const supabase = createSupabaseServiceClient()
  const clinic = await resolvePortalClinicBySlug(supabase, params.slug)
  if (!clinic) notFound()

  const rawCookie = cookies().get(PATIENT_SESSION_COOKIE_NAME)?.value
  const session = verifyPatientSessionCookie(rawCookie)
  if (!session || session.tenantId !== clinic.tenantId) {
    redirect(`/paciente/${params.slug}${rawCookie ? '?sessao=expirada' : ''}`)
  }

  const [bundle, enabledList] = await Promise.all([
    buildPatientPortalBundle(supabase, {
      tenantId: session.tenantId,
      patientId: session.patientId,
    }),
    listEnabledPortalSections(supabase, session.tenantId),
  ])
  const enabled = new Set(enabledList)
  const showMetricas = enabled.has('metricas')
  const showAtendimentos = enabled.has('atendimentos')
  const showOrientacoes = enabled.has('orientacoes')

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
  const hasVisibleContent =
    (showMetricas && hasMetricData) ||
    (showAtendimentos && bundle.appointments.length > 0) ||
    (showOrientacoes && bundle.careNotes.length > 0)

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title={bundle.patient.firstName ? `Olá, ${bundle.patient.firstName} 👋` : 'Olá 👋'}
        subtitle="Acompanhe seus dados de saúde — somente leitura."
        right={<PatientLogoutButton slug={params.slug} />}
      />

      {!hasVisibleContent ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            Ainda não há informações para exibir. Assim que a equipe da clínica
            registrar seus dados, eles aparecem aqui.
          </CardContent>
        </Card>
      ) : null}

      {showOrientacoes && bundle.careNotes.length > 0 ? (
        <Card className="rounded-2xl border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <ClipboardList className="h-4 w-4" />
              </span>
              Orientações da equipe
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bundle.careNotes.map((n) => (
              <div key={n.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {formatDateTimePtBr(n.createdAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {showMetricas && bundle.weightImc.length > 0 ? (
        <WeightImcChart points={bundle.weightImc} />
      ) : null}

      {showMetricas && hasAnyMetric ? (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <LineChart className="h-4 w-4" />
            </span>
            Métricas metabólicas
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {bundle.metricTypes
              .filter((t) => (bundle.metrics[t.metricType] ?? []).length > 0)
              .map((t) => (
                <MetricEvolutionChart
                  key={t.metricType}
                  label={t.label}
                  unit={t.unit}
                  points={(bundle.metrics[t.metricType] ?? []).map((m) => ({
                    date: m.measuredAt,
                    value: m.value,
                  }))}
                />
              ))}
          </div>
        </section>
      ) : null}

      {showAtendimentos ? (
        <Card className="rounded-2xl border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <CalendarDays className="h-4 w-4" />
              </span>
              Meus atendimentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bundle.appointments.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum atendimento registrado ainda.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {bundle.appointments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatDateTimePtBr(a.appointmentAt)}
                    </span>
                    {a.doctorName ? (
                      <span className="text-sm text-slate-600">{a.doctorName}</span>
                    ) : null}
                    {a.procedureName ? (
                      <span className="text-xs text-slate-400">{a.procedureName}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <footer className="text-center text-xs text-slate-400">
        <p>Sessão de 30 minutos. Cada acesso é registrado por segurança (LGPD).</p>
      </footer>
    </div>
  )
}

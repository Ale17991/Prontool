/**
 * Feature 030 — /paciente/[slug]/painel — portal do paciente (US1/US3).
 *
 * Server component SÓ-LEITURA (FR-004/FR-006). Exige sessão de paciente
 * válida E da clínica do slug — senão volta ao login. A identidade vem
 * exclusivamente do cookie HMAC verificado; o bundle filtra tudo por
 * patient_id+tenant_id da sessão. Cada render registra `view` (FR-020).
 */

import { notFound, redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { CalendarDays } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolvePortalClinicBySlug } from '@/lib/core/patient-portal/login'
import {
  PATIENT_SESSION_COOKIE_NAME,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'
import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import {
  hashIpForPatientPortal,
  logPatientAccess,
} from '@/lib/core/patient-portal/audit'
import {
  MetricEvolutionChart,
  WeightImcChart,
} from '@/components/patient-portal/evolution-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  // Sessão ausente/expirada ou de outra clínica → login. Cookie presente
  // mas inválido ≈ sessão expirada → login mostra o aviso (T036).
  if (!session || session.tenantId !== clinic.tenantId) {
    redirect(`/paciente/${params.slug}${rawCookie ? '?sessao=expirada' : ''}`)
  }

  const bundle = await buildPatientPortalBundle(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })

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
  const hasAnything =
    bundle.weightImc.length > 0 || hasAnyMetric || bundle.appointments.length > 0

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {clinic.displayName}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {bundle.patient.firstName ? `Olá, ${bundle.patient.firstName}` : 'Olá'}
          </h1>
          <p className="text-sm text-slate-500">
            Sua evolução e seus atendimentos — somente leitura.
          </p>
        </div>
        <PatientLogoutButton slug={params.slug} />
      </header>

      {!hasAnything ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            Ainda não há medições ou atendimentos registrados. Assim que a
            equipe da clínica registrar seus dados, eles aparecem aqui.
          </CardContent>
        </Card>
      ) : null}

      {bundle.weightImc.length > 0 ? (
        <WeightImcChart points={bundle.weightImc} />
      ) : hasAnything ? (
        <Card>
          <CardContent className="p-4 text-sm text-slate-500">
            Ainda não há registros de peso/IMC.
          </CardContent>
        </Card>
      ) : null}

      {hasAnyMetric ? (
        <section className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">
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
      ) : hasAnything ? (
        <Card>
          <CardContent className="p-4 text-sm text-slate-500">
            Ainda não há medições metabólicas registradas.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-primary" />
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

      <footer className="text-center text-xs text-slate-400">
        <p>
          Sessão de 30 minutos. Cada acesso é registrado por segurança (LGPD).
        </p>
      </footer>
    </div>
  )
}

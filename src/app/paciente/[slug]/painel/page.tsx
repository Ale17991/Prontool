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
import { hashIpForPatientPortal, logPatientAccess } from '@/lib/core/patient-portal/audit'
import { Card, CardContent } from '@/components/ui/card'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { PatientTimeline } from '@/components/patient-portal/patient-timeline'
import { PatientLogoutButton } from './logout-button'

export const dynamic = 'force-dynamic'

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
  const hasContent =
    (showMetricas && (bundle.weightImc.length > 0 || hasAnyMetric)) ||
    (showAtendimentos && bundle.appointments.length > 0) ||
    (showOrientacoes && bundle.careNotes.length > 0)

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title={bundle.patient.firstName ? `Olá, ${bundle.patient.firstName}` : 'Olá'}
        subtitle="Acompanhe sua evolução de saúde."
        right={<PatientLogoutButton slug={params.slug} />}
      />

      {hasContent ? (
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
            Ainda não há informações para exibir. Assim que a equipe da clínica
            registrar seus dados, eles aparecem aqui.
          </CardContent>
        </Card>
      )}

      <footer className="text-center text-xs text-slate-400">
        <p>Sessão de 30 minutos. Cada acesso é registrado por segurança (LGPD).</p>
      </footer>
    </div>
  )
}

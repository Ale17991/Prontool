/**
 * Feature 057 — /paciente/[slug]/painel/evolucao — seção "Minha evolução".
 *
 * Resumo dos indicadores atuais + linha do tempo só das MEDIÇÕES. Monta o
 * bundle completo de propósito: é ele que decide se os analitos de laboratório
 * saem daqui (quando a seção de exames está exibindo os mesmos valores) — regra
 * da 050 que não pode ser reimplementada em pedaços, sob pena de o exame voltar
 * a aparecer em dois lugares.
 */

import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { DashboardSummary } from '@/components/patient-portal/dashboard-summary'
import { PatientTimeline } from '@/components/patient-portal/patient-timeline'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalEvolucaoPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'metricas',
  })

  const bundle = await buildPatientPortalBundle(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })

  const hasAnyMetric = Object.values(bundle.metrics).some((s) => s.length > 0)
  const hasData = bundle.weightImc.length > 0 || hasAnyMetric

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

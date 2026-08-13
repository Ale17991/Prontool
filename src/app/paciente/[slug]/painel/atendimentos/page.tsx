/**
 * Feature 057 — /paciente/[slug]/painel/atendimentos — histórico de consultas.
 *
 * Busca só a sua fatia (FR-009: data, profissional e tipo — nada financeiro),
 * em vez do bundle inteiro: página de seção não precisa decifrar a identidade
 * do paciente nem carregar treino, dieta e exames para mostrar uma lista.
 */

import { listPortalAppointments } from '@/lib/core/patient-portal/read-portal'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { PatientTimeline } from '@/components/patient-portal/patient-timeline'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalAtendimentosPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'atendimentos',
  })

  const appointments = await listPortalAppointments(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Meus atendimentos"
        subtitle="Suas consultas, da mais recente para a mais antiga."
        backHref={`/paciente/${slug}/painel`}
      />

      {appointments.length > 0 ? (
        <PatientTimeline
          appointments={appointments}
          weightImc={[]}
          metrics={{}}
          metricTypes={[]}
          careNotes={[]}
        />
      ) : (
        <PortalEmpty>Você ainda não tem atendimentos registrados nesta clínica.</PortalEmpty>
      )}
    </div>
  )
}

/**
 * Feature 057 — /paciente/[slug]/painel/orientacoes — o que a equipe escreveu
 * para o paciente. Seção sensível (média): só chega aqui quem passou pelo gate
 * do `openPortalPage`, porque a clínica precisa ligá-la explicitamente.
 */

import { listCareNotes } from '@/lib/core/patient-portal/care-notes'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { PatientTimeline } from '@/components/patient-portal/patient-timeline'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalOrientacoesPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'orientacoes',
  })

  const careNotes = await listCareNotes(supabase, session.tenantId, session.patientId)

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Orientações"
        subtitle="Escritas pela equipe da clínica para você."
        backHref={`/paciente/${slug}/painel`}
      />

      {careNotes.length > 0 ? (
        <PatientTimeline
          appointments={[]}
          weightImc={[]}
          metrics={{}}
          metricTypes={[]}
          careNotes={careNotes}
        />
      ) : (
        <PortalEmpty>A equipe ainda não escreveu orientações para você.</PortalEmpty>
      )}
    </div>
  )
}

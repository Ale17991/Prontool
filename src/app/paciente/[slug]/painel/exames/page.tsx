/**
 * Feature 057 — /paciente/[slug]/painel/exames — resultados com interpretação.
 *
 * Monta o bundle completo porque a classificação da 050 depende de sexo/idade
 * do cadastro e do catálogo de métricas — `labResults` já chega filtrado de
 * "sem referência", que é o que impede o paciente de ver valor cru isolado.
 */

import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { LabResultsCard } from '@/components/patient-portal/lab-results-card'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalExamesPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'exames',
  })

  const bundle = await buildPatientPortalBundle(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })
  const items = bundle.labResults ?? []

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Resultados de exames"
        subtitle="Seus resultados mais recentes, já interpretados."
        backHref={`/paciente/${slug}/painel`}
      />

      {items.length > 0 ? (
        <LabResultsCard items={items} />
      ) : (
        <PortalEmpty>
          Nenhum resultado disponível ainda. Assim que a equipe registrar seus exames, eles aparecem
          aqui.
        </PortalEmpty>
      )}
    </div>
  )
}

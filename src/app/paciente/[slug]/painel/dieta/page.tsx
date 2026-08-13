/**
 * Feature 057 — /paciente/[slug]/painel/dieta — plano alimentar entregue.
 * Módulo `dieta`: o gate está no `openPortalPage`, não no card da home.
 */

import { getPortalDietPlan } from '@/lib/core/patient-portal/diet'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { DietCard } from '@/components/patient-portal/plan-cards'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalDietaPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'dieta',
  })

  const plan = await getPortalDietPlan(supabase, session.tenantId, session.patientId)

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Plano alimentar"
        subtitle="O plano prescrito pelo seu nutricionista."
        backHref={`/paciente/${slug}/painel`}
      />

      {plan ? (
        <DietCard plan={plan} />
      ) : (
        <PortalEmpty>Seu nutricionista ainda não cadastrou seu plano alimentar.</PortalEmpty>
      )}
    </div>
  )
}

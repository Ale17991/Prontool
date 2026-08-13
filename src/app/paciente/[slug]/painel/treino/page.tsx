/**
 * Feature 057 — /paciente/[slug]/painel/treino — rotina de treino ativa.
 * Módulo `treino`: o gate está no `openPortalPage`, não no card da home.
 */

import { getActiveWorkoutPlan } from '@/lib/core/patient-portal/workout'
import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { WorkoutCard } from '@/components/patient-portal/plan-cards'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalTreinoPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug } = await openPortalPage(params.slug, {
    section: 'treino',
  })

  const plan = await getActiveWorkoutPlan(supabase, session.tenantId, session.patientId)

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Rotina de treino"
        subtitle="O treino prescrito pelo seu profissional."
        backHref={`/paciente/${slug}/painel`}
      />

      {plan ? (
        <WorkoutCard plan={plan} />
      ) : (
        <PortalEmpty>Seu profissional ainda não cadastrou sua rotina de treino.</PortalEmpty>
      )}
    </div>
  )
}

/**
 * Feature 058 — /paciente/[slug]/painel/composicao — "Composição corporal".
 *
 * Busca só a sua fatia, como as demais páginas de área: quem monta o bundle
 * inteiro é a home (que precisa da prévia de todo card) e as páginas de evolução
 * e exames (onde o bundle completo é o que aplica a regra da 050 que impede o
 * mesmo analito de aparecer em dois lugares).
 *
 * O gate de seção fica em `openPortalPage`, e é ele que cumpre o FR-018: sem o
 * módulo `nutri_avaliacao`, ou com a seção desligada pela clínica, o endereço
 * digitado à mão volta para a home. Esconder o card seria esconder, não
 * controlar.
 */

import { openPortalPage } from '@/lib/core/patient-portal/page-guard'
import { getPortalBodyComposition } from '@/lib/core/patient-portal/body-composition'
import { PortalHeader } from '@/components/patient-portal/portal-header'
import { BodyCompositionCard } from '@/components/patient-portal/body-composition-card'
import { PortalEmpty } from '@/components/patient-portal/portal-empty'

export const dynamic = 'force-dynamic'

export default async function PortalComposicaoPage({ params }: { params: { slug: string } }) {
  const { supabase, clinic, session, slug, theme } = await openPortalPage(params.slug, {
    section: 'composicao',
  })

  const view = await getPortalBodyComposition(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })

  return (
    <div className="space-y-6">
      <PortalHeader
        clinicName={clinic.displayName}
        logoUrl={clinic.logoUrl}
        title="Composição corporal"
        subtitle="Do que o seu peso é feito, segundo a sua avaliação nutricional."
        backHref={`/paciente/${slug}/painel`}
      />

      {view.latest ? (
        <BodyCompositionCard view={view} palette={theme?.chart} />
      ) : (
        // Ausência EXPLICADA, nunca tela em branco (FR/edge case): o paciente
        // precisa saber que isso depende de uma avaliação na consulta, não de
        // algo que ele deixou de fazer aqui.
        <PortalEmpty>
          Sua composição corporal aparece aqui depois que a equipe fizer a avaliação nutricional na
          consulta.
        </PortalEmpty>
      )}
    </div>
  )
}

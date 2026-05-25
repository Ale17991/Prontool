import { AtendimentoDetailContent } from './_components/atendimento-detail-content'

/**
 * Detalhe do atendimento — rota standalone para deep-link, refresh,
 * compartilhamento de URL. O conteúdo vive em
 * `_components/atendimento-detail-content.tsx` e é reusado pelo Sheet
 * lateral em `@modal/(.)[id]/page.tsx` (intercepting route).
 */
export const dynamic = 'force-dynamic'

export default function AtendimentoDetailPage({ params }: { params: { id: string } }) {
  return <AtendimentoDetailContent appointmentId={params.id} />
}

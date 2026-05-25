import { AtendimentoDetailContent } from '../../[id]/_components/atendimento-detail-content'
import { SheetShell } from './sheet-shell'

/**
 * Intercepting route — quando o usuário clica num atendimento na lista
 * (`/operacao/atendimentos`), o Next.js renderiza este arquivo no slot
 * `@modal` em vez de navegar para `/operacao/atendimentos/[id]`. A URL
 * muda mas a lista permanece montada por baixo.
 *
 * Refresh da página (ou acesso direto à URL) cai na rota standalone
 * `[id]/page.tsx`, que renderiza o mesmo `<AtendimentoDetailContent />`
 * só que sem o Sheet — comportamento de deep-link preservado.
 */
export const dynamic = 'force-dynamic'

export default function AtendimentoModalPage({ params }: { params: { id: string } }) {
  return (
    <SheetShell>
      <AtendimentoDetailContent appointmentId={params.id} fromModal />
    </SheetShell>
  )
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { listSupportTickets, type SupportTicketRow } from '@/lib/core/support-tickets/list'
import { TicketsList } from './tickets-list'

export const dynamic = 'force-dynamic'

/**
 * Tickets de bug/sugestão/suporte de todas as clínicas.
 *
 * A 0109 previu esta tela ("preparado para painel admin futuro") e a leitura
 * ficou no e-mail. O conteúdo do chamado é a parte que importa, e depender da
 * caixa de entrada significava que ele existia mas não era consultável.
 *
 * Mostra também o desfecho do envio ao CRM (`crm_status`, 0219): falha ali é
 * silenciosa por desenho, e sem esta coluna visível só se descobria perguntando.
 */
export default async function AdminTicketsPage() {
  const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

  let tickets: SupportTicketRow[] = []
  let erro: string | null = null
  try {
    tickets = await listSupportTickets(sb)
  } catch (e) {
    erro = e instanceof Error ? e.message : 'Falha ao carregar tickets.'
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Tickets</h2>
        <p className="mt-1 text-sm text-slate-500">
          Bugs, sugestões e pedidos de suporte enviados pelas clínicas. Clique para ler o texto
          completo e ver se o chamado chegou ao CRM.
        </p>
      </div>

      {erro ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {erro}
        </p>
      ) : (
        <TicketsList tickets={tickets} />
      )}
    </div>
  )
}

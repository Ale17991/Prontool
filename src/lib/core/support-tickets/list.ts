/**
 * Leitura dos tickets para o painel da plataforma.
 *
 * Cross-tenant, service client, atrás de `requireSuperAdmin` — é a operação da
 * Clinni lendo o que as clínicas escreveram, não uma clínica lendo a própria
 * caixa. A 0109 previu esta tela ("preparado para painel admin futuro") e a
 * leitura ficou no e-mail por um ano.
 *
 * A DESCRIÇÃO VEM INTEIRA. É a parte que importa: quem abre um chamado escreve
 * o problema ali, e uma lista que corta o texto obriga a ir procurar em outro
 * lugar — que era exatamente o motivo de a tela não existir resolver nada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { SupportTicketKind } from './schema'

export interface SupportTicketRow {
  id: string
  tenantId: string
  clinica: string
  kind: SupportTicketKind
  title: string
  description: string
  status: string
  pageUrl: string | null
  userEmail: string | null
  userRole: string | null
  createdAt: string
  /** `null` = ticket anterior à 0219 ou CRM desconfigurado. */
  crmStatus: string | null
  crmDetail: Record<string, unknown> | null
}

interface Row {
  id: string
  tenant_id: string
  kind: string
  title: string
  description: string
  status: string
  page_url: string | null
  user_email_cache: string | null
  user_role_cache: string | null
  created_at: string
  crm_status: string | null
  crm_detail: Record<string, unknown> | null
}

const COLUNAS =
  'id, tenant_id, kind, title, description, status, page_url, user_email_cache, user_role_cache, created_at, crm_status, crm_detail'

/**
 * Últimos tickets, mais recentes primeiro.
 *
 * Teto explícito em vez de paginação: o volume é de alguns por dia, e uma tela
 * que carrega o suficiente para rolar é mais útil que uma que obriga a clicar.
 * Quando o volume justificar, isto vira paginação — e o teto aqui é o aviso de
 * que a hora chegou, em vez de o PostgREST cortar em 1.000 sem avisar.
 */
export async function listSupportTickets(
  supabase: SupabaseClient<Database>,
  limite = 200,
): Promise<SupportTicketRow[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(COLUNAS)
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error(`listSupportTickets failed: ${error.message}`)

  const linhas = (data ?? []) as unknown as Row[]
  if (linhas.length === 0) return []

  const ids = [...new Set(linhas.map((l) => l.tenant_id))]
  const { data: tenants } = await supabase.from('tenants').select('id, name').in('id', ids)
  const nomePorId = new Map(
    ((tenants ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )

  return linhas.map((l) => ({
    id: l.id,
    tenantId: l.tenant_id,
    clinica: nomePorId.get(l.tenant_id) ?? '—',
    kind: l.kind as SupportTicketKind,
    title: l.title,
    description: l.description,
    status: l.status,
    pageUrl: l.page_url,
    userEmail: l.user_email_cache,
    userRole: l.user_role_cache,
    createdAt: l.created_at,
    crmStatus: l.crm_status,
    crmDetail: l.crm_detail,
  }))
}

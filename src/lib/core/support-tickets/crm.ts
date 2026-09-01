/**
 * Ticket de suporte vira contato no CRM da HOMIO (GoHighLevel).
 *
 * ESCOPO — a distinção que mais importa neste arquivo: `tenant_integrations` +
 * `withGhlAuth` autenticam contra a sub-conta GHL de CADA CLÍNICA. Mandar o
 * ticket por lá criaria o lead dentro do CRM da própria clínica que abriu o
 * chamado. Aqui o destino é FIXO e é nosso: uma location da Homio, com um
 * Private Integration Token de plataforma — mesmo desenho da conta Asaas.
 *
 * Por isso este módulo NÃO entra no registry de `IntegrationAdapter`: aquele
 * contrato é event-bus por tenant, e o que se quer aqui é o oposto.
 *
 * O CONTATO É A CLÍNICA, não a pessoa. Cada ticket vira uma NOTA nesse
 * contato, com quem escreveu. Um contato por pessoa espalharia a mesma conta
 * em vários registros, e conversa comercial acontece no nível da clínica.
 *
 * Tudo aqui é BEST-EFFORT: o ticket já está gravado quando chegamos, e o GHL
 * fora do ar não pode transformar "reclamação registrada" em erro na cara de
 * quem estava tentando pedir ajuda.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { GHL_API_BASE } from '@/lib/integrations/ghl/oauth/types'
import { buildHeaders, fetchWithRetry } from '@/lib/integrations/ghl/create-contact'
import { KIND_LABELS, type SupportTicketKind } from './schema'

/**
 * Nomes EXATOS dos campos personalizados na location da Homio.
 *
 * A resolução é por NOME e não por id de propósito: id de campo do GHL só
 * existe depois de criado, e exigi-lo em env transformaria "criar um campo" em
 * "criar um campo, copiar o id e fazer deploy". Campo ausente é simplesmente
 * pulado — nunca derruba o envio.
 */
export const CAMPOS_GHL = {
  tenantId: 'Clinni ID',
  slug: 'Clinni Slug',
  plano: 'Clinni Plano',
  situacao: 'Clinni Situação',
  ultimoContato: 'Clinni Último contato',
  quemAbriu: 'Clinni Quem abriu',
} as const

const TAG_POR_TIPO: Record<SupportTicketKind, string> = {
  bug: 'clinni-bug',
  suggestion: 'clinni-sugestao',
  support: 'clinni-suporte',
}

export function isHomioCrmConfigured(): boolean {
  return Boolean(process.env.GHL_HOMIO_TOKEN && process.env.GHL_HOMIO_LOCATION_ID)
}

function credenciais(): { token: string; locationId: string } {
  const token = process.env.GHL_HOMIO_TOKEN
  const locationId = process.env.GHL_HOMIO_LOCATION_ID
  if (!token || !locationId) throw new Error('GHL_HOMIO_TOKEN/LOCATION_ID ausentes')
  return { token, locationId }
}

// =========================================================================
// Campos personalizados — resolvidos por nome, com cache de processo
// =========================================================================

let cacheCampos: { locationId: string; emMs: number; porNome: Map<string, string> } | null = null
const CACHE_MS = 10 * 60 * 1000

/**
 * Mapa nome→id dos campos personalizados da location.
 *
 * O cache é de processo e curto: campo novo aparece em minutos sem deploy, e
 * uma instância nova já nasce com a lista atual. Falha na busca devolve mapa
 * VAZIO em vez de lançar — sem campo personalizado o contato ainda é criado,
 * que é melhor que perder o lead por causa de um metadado.
 */
async function camposPorNome(token: string, locationId: string): Promise<Map<string, string>> {
  if (
    cacheCampos &&
    cacheCampos.locationId === locationId &&
    Date.now() - cacheCampos.emMs < CACHE_MS
  ) {
    return cacheCampos.porNome
  }
  const porNome = new Map<string, string>()
  try {
    const res = await fetchWithRetry(
      `${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}/customFields`,
      { method: 'GET', headers: buildHeaders(token) },
    )
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        customFields?: Array<{ id?: string; name?: string }>
      } | null
      for (const c of body?.customFields ?? []) {
        if (c.id && c.name) porNome.set(c.name.trim().toLowerCase(), c.id)
      }
    } else {
      logger.warn({ status: res.status }, 'homio-crm-custom-fields-failed')
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'homio-crm-custom-fields-error',
    )
  }
  cacheCampos = { locationId, emMs: Date.now(), porNome }
  return porNome
}

function montarCampos(
  porNome: Map<string, string>,
  valores: Partial<Record<keyof typeof CAMPOS_GHL, string | null>>,
): Array<{ id: string; value: string }> {
  const out: Array<{ id: string; value: string }> = []
  for (const [chave, nome] of Object.entries(CAMPOS_GHL) as Array<
    [keyof typeof CAMPOS_GHL, string]
  >) {
    const valor = valores[chave]
    if (!valor) continue
    const id = porNome.get(nome.trim().toLowerCase())
    if (id) out.push({ id, value: valor })
  }
  return out
}

// =========================================================================
// Contato da clínica
// =========================================================================

interface DadosClinica {
  tenantId: string
  nome: string
  slug: string | null
  email: string | null
  telefone: string | null
  plano: string | null
  situacao: string | null
}

async function contatoGravado(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  locationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('tenant_crm_contacts' as never)
    .select('ghl_contact_id, ghl_location_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const row = data as unknown as { ghl_contact_id: string; ghl_location_id: string } | null
  // Location diferente = a Homio trocou de conta. O id antigo aponta para um
  // contato que não existe aqui; melhor recriar que escrever no vazio (0218 D2).
  if (!row || row.ghl_location_id !== locationId) return null
  return row.ghl_contact_id
}

/**
 * Encontra ou cria o contato da clínica e atualiza os campos de contexto.
 *
 * `POST /contacts/upsert` dedupe por e-mail/telefone dentro da location. A
 * ponte em `tenant_crm_contacts` cobre o caso que ele não cobre: clínica sem
 * e-mail nem telefone cadastrados, que geraria um contato novo a cada ticket.
 */
async function garantirContato(
  supabase: SupabaseClient<Database>,
  clinica: DadosClinica,
  quemAbriu: string | null,
  tipo: SupportTicketKind,
): Promise<string | null> {
  const { token, locationId } = credenciais()
  const porNome = await camposPorNome(token, locationId)
  const customFields = montarCampos(porNome, {
    tenantId: clinica.tenantId,
    slug: clinica.slug,
    plano: clinica.plano,
    situacao: clinica.situacao,
    ultimoContato: new Date().toISOString().slice(0, 10),
    quemAbriu,
  })
  const tags = ['clinni', TAG_POR_TIPO[tipo]]

  const existente = await contatoGravado(supabase, clinica.tenantId, locationId)

  if (existente) {
    // Atualiza contexto sem mexer em nada que a operação tenha editado à mão
    // no GHL além destes campos. Falhar aqui não impede a nota.
    const res = await fetchWithRetry(`${GHL_API_BASE}/contacts/${encodeURIComponent(existente)}`, {
      method: 'PUT',
      headers: buildHeaders(token),
      body: JSON.stringify({ tags, ...(customFields.length > 0 ? { customFields } : {}) }),
    })
    if (!res.ok) {
      logger.warn({ status: res.status, tenant_id: clinica.tenantId }, 'homio-crm-update-failed')
    }
    return existente
  }

  const res = await fetchWithRetry(`${GHL_API_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({
      locationId,
      name: clinica.nome,
      companyName: clinica.nome,
      ...(clinica.email ? { email: clinica.email } : {}),
      ...(clinica.telefone ? { phone: clinica.telefone } : {}),
      tags,
      source: 'clinni-suporte',
      ...(customFields.length > 0 ? { customFields } : {}),
    }),
  })
  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    logger.warn(
      { status: res.status, body: texto.slice(0, 200), tenant_id: clinica.tenantId },
      'homio-crm-upsert-failed',
    )
    return null
  }
  const body = (await res.json().catch(() => null)) as {
    contact?: { id?: string }
    id?: string
  } | null
  const contactId = body?.contact?.id ?? body?.id ?? null
  if (!contactId) return null

  const { error } = await supabase.from('tenant_crm_contacts' as never).upsert(
    {
      tenant_id: clinica.tenantId,
      ghl_contact_id: contactId,
      ghl_location_id: locationId,
    } as never,
    { onConflict: 'tenant_id' },
  )
  if (error) {
    // A ponte é otimização, não requisito: sem ela o próximo ticket reencontra
    // o contato pelo upsert (desde que a clínica tenha e-mail ou telefone).
    logger.warn({ err: error.message, tenant_id: clinica.tenantId }, 'homio-crm-bridge-save-failed')
  }
  return contactId
}

// =========================================================================
// Entrada
// =========================================================================

export interface TicketParaCrm {
  ticketId: string
  kind: SupportTicketKind
  title: string
  description: string
  pageUrl: string | null
  userEmail: string | null
  userRole: string | null
}

/**
 * Leva o ticket para o CRM da Homio. Nunca lança: devolve `false` e registra.
 *
 * A chamada é síncrona dentro do request porque o volume é de alguns tickets
 * por dia e o custo é uma ida e volta curta. Fire-and-forget em serverless
 * seria pior: o processo pode ser encerrado logo após a resposta, e o lead
 * sumiria sem deixar rastro.
 */
export async function sendTicketToHomioCrm(
  supabase: SupabaseClient<Database>,
  clinica: DadosClinica,
  ticket: TicketParaCrm,
): Promise<boolean> {
  if (!isHomioCrmConfigured()) return false
  try {
    const { token } = credenciais()
    const contactId = await garantirContato(supabase, clinica, ticket.userEmail, ticket.kind)
    if (!contactId) return false

    const linhas = [
      `[${KIND_LABELS[ticket.kind]}] ${ticket.title}`,
      '',
      ticket.description,
      '',
      `Quem abriu: ${ticket.userEmail ?? '—'}${ticket.userRole ? ` (${ticket.userRole})` : ''}`,
      `Clínica: ${clinica.nome}${clinica.slug ? ` (${clinica.slug})` : ''}`,
      ticket.pageUrl ? `Tela: ${ticket.pageUrl}` : null,
      `Ticket: ${ticket.ticketId}`,
    ].filter((l): l is string => l !== null)

    const res = await fetchWithRetry(
      `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}/notes`,
      {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ body: linhas.join('\n') }),
      },
    )
    if (!res.ok) {
      logger.warn({ status: res.status, ticket_id: ticket.ticketId }, 'homio-crm-note-failed')
      return false
    }
    logger.info(
      { event: 'support_ticket.sent_to_crm', ticket_id: ticket.ticketId, kind: ticket.kind },
      'support-ticket-sent-to-crm',
    )
    return true
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), ticket_id: ticket.ticketId },
      'homio-crm-send-failed',
    )
    return false
  }
}

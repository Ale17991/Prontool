/**
 * Porta de entrada única da API de parceiro.
 *
 * Mesmo papel que `printouts/guard.ts` cumpre nos impressos e `openPortalPage`
 * no portal do paciente: autenticação, escopo, recorte por parceiro, trilha de
 * acesso e formato de erro moram AQUI, e não em cada rota. Com três rotas hoje
 * a repetição pareceria inofensiva; é a quarta que nasce sem a trilha.
 *
 * O recorte por parceiro é o análogo do isolamento por tenant: nenhuma rota
 * recebe o `partner_id` do cliente — ele sai da CHAVE apresentada, e a chave
 * não escolhe de quem é. Um parceiro não consegue nomear outro.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { getPartner, type BillingPartner } from '@/lib/core/billing/partners'
import { resolveApiKey, touchLastUsed, type PartnerScope } from './api-keys'
import { PartnerDenied } from './errors'
import { ipPermitido } from './ip'

/**
 * Teto de requisições por chave, por minuto.
 *
 * Dimensionado para a integração real: percorrer um mês de movimentações de
 * uma clínica grande são poucas dezenas de páginas. Cento e vinte por minuto
 * atende isso com folga e ainda assim impede que uma chave vazada varra a base
 * inteira antes de alguém perceber.
 */
const LIMITE_POR_MINUTO = 120

export interface PartnerContext {
  partner: BillingPartner
  keyId: string
  supabase: SupabaseClient<Database>
  ip: string | null
}

export { PartnerDenied }

function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd ? (fwd.split(',')[0]?.trim() ?? null) : null
}

/**
 * Extrai a chave do header. Aceita `Authorization: Bearer <chave>` e
 * `X-Api-Key: <chave>` — o segundo porque metade dos clientes HTTP de mercado
 * manda assim e recusar custaria uma ida e volta de suporte sem ganho nenhum
 * de segurança: as duas viajam pelo mesmo TLS.
 */
function extractKey(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const xkey = req.headers.get('x-api-key')
  return xkey?.trim() || null
}

/**
 * Autentica e autoriza. Lança `PartnerDenied` — a rota não decide status.
 *
 * Parceiro INATIVO é recusado aqui: desligar o parceiro no /admin tem que
 * cortar o acesso de verdade, não só parar o split. Deixar a chave funcionando
 * faria "inativo" significar coisas diferentes em dois lugares.
 */
export async function openPartnerRequest(
  req: Request,
  scope: PartnerScope,
): Promise<PartnerContext> {
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const raw = extractKey(req)
  if (!raw) {
    throw new PartnerDenied(401, 'MISSING_KEY', 'Envie a chave em Authorization: Bearer <chave>.')
  }

  const resolved = await resolveApiKey(supabase, raw)
  if (!resolved) {
    // Uma mensagem só para chave inválida, revogada ou inexistente — ver
    // `resolveApiKey`: distinguir os casos confirma prefixo válido.
    throw new PartnerDenied(401, 'INVALID_KEY', 'Chave inválida ou revogada.')
  }

  if (!resolved.scopes.includes(scope)) {
    throw new PartnerDenied(403, 'MISSING_SCOPE', `Esta chave não tem o escopo '${scope}'.`)
  }

  const ip = clientIp(req)
  // A faixa é checada ANTES do parceiro e antes do teto: se a origem não é
  // permitida, nem o nome do parceiro deve ser consultado. Mesma resposta de
  // chave inválida — dizer "sua chave é boa, seu IP que não é" entrega ao
  // atacante a informação de que a chave roubada funciona em outro lugar.
  if (!ipPermitido(ip, resolved.allowedIps)) {
    logger.warn(
      { event: 'partner_api.ip_blocked', key_id: resolved.keyId, ip },
      'partner-api-ip-blocked',
    )
    throw new PartnerDenied(401, 'INVALID_KEY', 'Chave inválida ou revogada.')
  }

  const partner = await getPartner(supabase, resolved.partnerId)
  if (!partner) throw new PartnerDenied(401, 'INVALID_KEY', 'Chave inválida ou revogada.')
  if (partner.status !== 'active') {
    throw new PartnerDenied(403, 'PARTNER_INACTIVE', 'Parceiro inativo.')
  }

  await aplicarTeto(supabase, resolved.keyId)
  await touchLastUsed(supabase, resolved.keyId)
  return { partner, keyId: resolved.keyId, supabase, ip }
}

/**
 * Teto de requisições por chave (0215 D3).
 *
 * O contador vive no banco porque contador em memória não sobrevive a
 * serverless: cada instância teria o próprio, e o teto real seria o teto vezes
 * o número de instâncias em pé.
 *
 * Falha do contador NÃO derruba a requisição — é proteção contra abuso, não
 * autenticação, e transformar uma indisponibilidade do contador em recusa
 * geral trocaria "alguém pode abusar por um minuto" por "o parceiro parou".
 */
async function aplicarTeto(supabase: SupabaseClient<Database>, keyId: string): Promise<void> {
  const agora = new Date()
  agora.setSeconds(0, 0)
  try {
    const { data, error } = await supabase.rpc(
      'partner_api_rate_hit' as never,
      {
        p_api_key_id: keyId,
        p_window_start: agora.toISOString(),
      } as never,
    )
    if (error) throw new Error(error.message)
    const hits = Number(data ?? 0)
    if (hits > LIMITE_POR_MINUTO) {
      throw new PartnerDenied(
        429,
        'RATE_LIMITED',
        `Limite de ${LIMITE_POR_MINUTO} requisições por minuto excedido. Aguarde e repita.`,
      )
    }
  } catch (err) {
    if (err instanceof PartnerDenied) throw err
    logger.error(
      { event: 'partner_api.rate_limit_failed', key_id: keyId },
      'partner-rate-limit-failed',
    )
  }
}

/**
 * Registra o que saiu (0213 D4). Best-effort: uma falha de gravação de trilha
 * não pode transformar uma leitura correta em erro para o parceiro. A falha vai
 * para o log de aplicação, onde é visível sem quebrar a integração.
 */
export async function logPartnerAccess(
  ctx: {
    supabase: SupabaseClient<Database>
    partner: BillingPartner
    keyId: string
    ip: string | null
  },
  entry: {
    endpoint: string
    tenantId?: string | null
    resultCount?: number | null
    status: number
  },
): Promise<void> {
  try {
    await ctx.supabase.from('partner_api_access_log' as never).insert({
      partner_id: ctx.partner.id,
      api_key_id: ctx.keyId,
      endpoint: entry.endpoint,
      tenant_id: entry.tenantId ?? null,
      result_count: entry.resultCount ?? null,
      status: entry.status,
      ip: ctx.ip,
    } as never)
  } catch (err) {
    logger.error(
      {
        event: 'partner_api.access_log_failed',
        partner: ctx.partner.slug,
        endpoint: entry.endpoint,
        err: err instanceof Error ? err.message : String(err),
      },
      'partner-access-log-failed',
    )
  }
}

/**
 * Igual a `openPartnerRequest`, mais a checagem de que a clínica pedida é deste
 * parceiro. Toda rota sob `/clinicas/{id}/…` passa por aqui.
 *
 * Clínica de outro parceiro (ou inexistente) dá **404, nunca 403** — mesma
 * doutrina de `printouts/guard.ts`: 403 confirmaria que o id existe, e é assim
 * que se levanta a carteira de clientes da concorrência, um id de cada vez.
 */
export async function openPartnerClinicRequest(
  req: Request,
  scope: PartnerScope,
  tenantId: string,
): Promise<PartnerContext> {
  const ctx = await openPartnerRequest(req, scope)
  const { partnerOwnsClinic } = await import('./clinics')
  if (!(await partnerOwnsClinic(ctx.supabase, ctx.partner.id, tenantId))) {
    throw new PartnerDenied(404, 'NOT_FOUND', 'Clínica não encontrada.')
  }
  return ctx
}

/**
 * Status que este erro vai produzir. A trilha de acesso precisa registrar o que
 * o parceiro realmente recebeu — anotar 500 num 400 de período longo demais
 * transformaria um limite conhecido em incidente na hora de investigar.
 */
/**
 * Cabeçalhos de toda resposta de parceiro.
 *
 * `no-store` porque o corpo carrega CPF e faturamento: um cache intermediário
 * ou o disco do navegador de quem testou no Postman não são lugar para isso.
 * Sem CORS de propósito — esta API é servidor-para-servidor, e permitir
 * origem cruzada convidaria o parceiro a chamá-la do navegador do cliente
 * dele, o que exporia a chave a qualquer pessoa com o inspetor aberto.
 */
export const CABECALHOS_PARCEIRO: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

/** `NextResponse.json` com os cabeçalhos acima. Use SEMPRE nas rotas de parceiro. */
export function respostaParceiro(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: CABECALHOS_PARCEIRO })
}

export function statusDoErro(err: unknown): number {
  return err instanceof PartnerDenied ? err.status : 500
}

export function partnerDeniedResponse(err: unknown, endpoint: string): Response {
  if (err instanceof PartnerDenied) {
    return NextResponse.json(
      { error: { code: err.code, message: err.publicMessage } },
      { status: err.status, headers: CABECALHOS_PARCEIRO },
    )
  }
  logger.error(
    { endpoint, err: err instanceof Error ? err.message : String(err) },
    'partner-api-failed',
  )
  // Nunca ecoamos a mensagem interna: ela cita nome de tabela e coluna.
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Erro ao processar a requisição.' } },
    { status: 500, headers: CABECALHOS_PARCEIRO },
  )
}

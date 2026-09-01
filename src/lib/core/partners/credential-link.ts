/**
 * Entrega da credencial de parceiro por LINK DE USO ÚNICO.
 *
 * O problema que isto resolve: a chave precisa sair daqui e chegar ao
 * desenvolvedor do parceiro. Colada num WhatsApp ou num e-mail, ela fica para
 * sempre no histórico de dois aparelhos, no backup de ambos e na busca de quem
 * um dia herdar aquela caixa. O link expira, queima ao ser aberto e deixa
 * registro de quando e de onde foi aberto.
 *
 * O segredo fica CIFRADO na linha até ser revelado, e a revelação o APAGA —
 * há um CHECK no banco garantindo que linha revelada não carrega credencial.
 * Não sobra um segredo recuperável parado em lugar nenhum.
 *
 * REVELAR É POST, NUNCA GET (0215 D2). Cliente de e-mail e antivírus
 * corporativo pré-carregam links; um GET que consome faria a credencial ser
 * queimada por um robô antes de o parceiro abrir a mensagem.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'
import { issueApiKey, type PartnerScope } from './api-keys'

/** Prazo do link. Curto de propósito: é para ser usado agora, não guardado. */
const TTL_HORAS_PADRAO = 48
const TTL_HORAS_MAX = 168

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function chaveDeCifra(): string {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to store partner credential')
  return key
}

export interface CredentialLink {
  /** URL completa para entregar ao parceiro. */
  url: string
  token: string
  expiresAt: string
  /** Prefixo público da chave emitida — serve para identificar/revogar. */
  keyPrefix: string
  apiKeyId: string
}

/**
 * Emite a chave e cria o link que a entrega.
 *
 * Uma coisa só, de propósito: chave emitida sem link seria uma credencial que
 * ninguém consegue ver (só guardamos o hash) e que ficaria ativa para sempre
 * no meio da lista. Aqui, emitir é sempre emitir-e-poder-entregar.
 */
export async function createCredentialLink(
  supabase: SupabaseClient<Database>,
  actorId: string,
  input: {
    partnerId: string
    name: string
    scopes: PartnerScope[]
    allowedIps?: string[] | null
    /** Validade da CHAVE (não do link). ISO ou null. */
    keyExpiresAt?: string | null
    /** Validade do LINK, em horas. */
    ttlHoras?: number
    baseUrl: string
  },
): Promise<CredentialLink> {
  const ttl = Math.min(Math.max(input.ttlHoras ?? TTL_HORAS_PADRAO, 1), TTL_HORAS_MAX)

  const issued = await issueApiKey(supabase, actorId, {
    partnerId: input.partnerId,
    name: input.name,
    scopes: input.scopes,
    allowedIps: input.allowedIps ?? null,
    expiresAt: input.keyExpiresAt ?? null,
  })

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString()

  const cifra = await supabase.rpc('enc_text_with_key', {
    plain: issued.secret,
    key: chaveDeCifra(),
  })
  if (cifra.error || !cifra.data) {
    throw new Error(`enc_text_with_key failed: ${cifra.error?.message ?? 'null ciphertext'}`)
  }

  const { error } = await supabase.from('partner_credential_links' as never).insert({
    api_key_id: issued.key.id,
    token_hash: sha256(token),
    secret_enc: cifra.data,
    expires_at: expiresAt,
    created_by: actorId,
  } as never)
  if (error) throw new Error(`createCredentialLink failed: ${error.message}`)

  logger.info(
    {
      event: 'partner_credential_link.created',
      actor_id: actorId,
      partner_id: input.partnerId,
      key_prefix: issued.key.keyPrefix,
      ttl_horas: ttl,
    },
    'partner-credential-link-created',
  )

  return {
    url: `${input.baseUrl.replace(/\/+$/, '')}/parceiro/credenciais/${token}`,
    token,
    expiresAt,
    keyPrefix: issued.key.keyPrefix,
    apiKeyId: issued.key.id,
  }
}

export type LinkStatus = 'valido' | 'usado' | 'expirado' | 'desconhecido'

export interface LinkInfo {
  status: LinkStatus
  /** Presente só quando `valido` — para a tela dizer de quem é a credencial. */
  parceiro?: string
  expiresAt?: string
}

/**
 * Estado do link, SEM consumi-lo. É o que a tela de confirmação mostra.
 *
 * Token desconhecido, expirado e já usado são estados distintos aqui de
 * propósito: quem abre o link é o parceiro legítimo, e "já foi usado" é a
 * informação que faz ele pedir outro em vez de insistir. Isso é o oposto da
 * autenticação da API, onde distinguir ajudaria quem está adivinhando — aqui o
 * token tem 256 bits e não se adivinha.
 */
export async function peekCredentialLink(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<LinkInfo> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { status: 'desconhecido' }

  const { data } = await supabase
    .from('partner_credential_links' as never)
    .select('id, api_key_id, expires_at, revealed_at')
    .eq('token_hash', sha256(token))
    .maybeSingle()
  if (!data) return { status: 'desconhecido' }

  const row = data as unknown as {
    api_key_id: string
    expires_at: string
    revealed_at: string | null
  }
  if (row.revealed_at) return { status: 'usado' }
  if (new Date(row.expires_at).getTime() <= Date.now()) return { status: 'expirado' }

  const { data: chave } = await supabase
    .from('partner_api_keys' as never)
    .select('partner_id, billing_partners(name)')
    .eq('id', row.api_key_id)
    .maybeSingle()
  const nome = (chave as unknown as { billing_partners?: { name?: string } } | null)
    ?.billing_partners?.name

  return { status: 'valido', parceiro: nome, expiresAt: row.expires_at }
}

/**
 * Revela a credencial e queima o link. Só deve ser chamada de um POST.
 *
 * Uma chamada só, à RPC `reveal_partner_credential` (0217). A versão anterior
 * fazia em dois passos — marcava `revealed_at` para reservar a linha, lia o
 * segredo, depois apagava — e o primeiro passo criava o estado que o CHECK
 * `partner_credential_links_burned` proíbe: revelado COM segredo. Todo revelar
 * quebrava com `23514`, e o parceiro via uma tela de erro genérica.
 *
 * O uso único agora é o `FOR UPDATE` dentro da função: duas chamadas
 * simultâneas disputam a linha, e a segunda não encontra mais nada elegível.
 */
export async function revealCredentialLink(
  supabase: SupabaseClient<Database>,
  token: string,
  ip: string | null,
): Promise<{ secret: string } | { erro: LinkStatus }> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { erro: 'desconhecido' }

  const { data, error } = await supabase.rpc(
    'reveal_partner_credential' as never,
    {
      p_token_hash: sha256(token),
      p_key: chaveDeCifra(),
      p_ip: ip,
    } as never,
  )
  if (error) throw new Error(`reveal_partner_credential failed: ${error.message}`)

  if (!data) {
    // Nada a revelar: inexistente, já revelado ou expirado. Consultamos o
    // estado só para dizer QUAL — a decisão já foi tomada dentro da função.
    const info = await peekCredentialLink(supabase, token)
    return { erro: info.status === 'valido' ? 'usado' : info.status }
  }

  logger.info({ event: 'partner_credential_link.revealed' }, 'partner-credential-link-revealed')
  return { secret: String(data) }
}

/** Valida as faixas digitadas no /admin antes de gravar. */
export function validarFaixas(linhas: string): string[] | null {
  const itens = linhas
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (itens.length === 0) return null

  for (const item of itens) {
    const [ip, bits] = item.split('/')
    const octetos = (ip ?? '').split('.')
    const ipOk =
      octetos.length === 4 && octetos.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
    const bitsOk = bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32)
    if (!ipOk || !bitsOk) {
      throw new ValidationError(
        `Faixa de IP inválida: "${item}". Use 203.0.113.7 ou 203.0.113.0/24.`,
      )
    }
  }
  return itens
}

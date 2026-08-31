/**
 * Credenciais da API de parceiro.
 *
 * A chave tem duas partes: um PREFIXO público, que identifica a linha, e um
 * SEGREDO, do qual guardamos só o SHA-256. O segredo aparece uma única vez, na
 * criação. Não dá para "reexibir" — só emitir outra e revogar a antiga, que é
 * exatamente o comportamento que se quer de uma credencial.
 *
 * Por que SHA-256 e não bcrypt/argon: o segredo são 32 bytes de aleatoriedade
 * criptográfica, não uma senha escolhida por gente. Não há dicionário a atacar,
 * e um KDF lento custaria latência em TODA requisição do parceiro sem comprar
 * segurança. O que precisamos é que vazar o banco não vaze a chave — e o hash
 * de um segredo de alta entropia já entrega isso.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'
import { PARTNER_SCOPES as SCOPES, type PartnerApiKey, type PartnerScope } from './scopes'

// Escopos e a projeção segura da chave vivem em `scopes.ts`, sem `node:crypto`
// — é de lá que a tela do /admin importa. Reexportados aqui por conveniência do
// servidor; um client component que importar DESTE arquivo quebra o build.
export { PARTNER_SCOPES, SCOPE_LABEL } from './scopes'
export type { PartnerScope, PartnerApiKey } from './scopes'

interface KeyRow {
  id: string
  partner_id: string
  name: string
  key_prefix: string
  scopes: string[] | null
  allowed_ips: string[] | null
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

const SAFE_COLUMNS =
  'id, partner_id, name, key_prefix, scopes, allowed_ips, expires_at, last_used_at, revoked_at, created_at'

function mapRow(r: KeyRow): PartnerApiKey {
  return {
    id: r.id,
    partnerId: r.partner_id,
    name: r.name,
    keyPrefix: r.key_prefix,
    scopes: (r.scopes ?? []) as PartnerScope[],
    allowedIps: r.allowed_ips,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * Quebra a chave apresentada em prefixo + segredo.
 *
 * Formato: `clinni_<prefixo>_<segredo>`. O nome do produto no começo existe
 * para que uma chave vazada num log ou num repositório seja RECONHECÍVEL como
 * nossa — é o que permite avisar o parceiro em vez de descobrir pelo uso.
 */
export function parseApiKey(raw: string): { prefix: string; secret: string } | null {
  const parts = raw.trim().split('_')
  if (parts.length !== 3) return null
  const [brand, prefix, secret] = parts
  if (brand !== 'clinni' || !prefix || !secret) return null
  if (!/^[a-f0-9]{16}$/.test(prefix) || !/^[a-f0-9]{64}$/.test(secret)) return null
  return { prefix, secret }
}

export interface IssuedKey {
  key: PartnerApiKey
  /** Só existe aqui, nesta resposta. Não é recuperável depois. */
  secret: string
}

export async function issueApiKey(
  supabase: SupabaseClient<Database>,
  actorId: string,
  input: {
    partnerId: string
    name: string
    scopes: PartnerScope[]
    /** Faixas CIDR/IPs. `null` = sem restrição. */
    allowedIps?: string[] | null
    /** ISO. `null` = sem prazo. */
    expiresAt?: string | null
  },
): Promise<IssuedKey> {
  if (!input.name.trim()) throw new ValidationError('Dê um nome à chave (ex.: "produção").')
  const scopes = input.scopes.filter((s) => (SCOPES as readonly string[]).includes(s))
  if (scopes.length === 0) {
    // Chave sem escopo autenticaria e não leria nada — parece funcionar e
    // devolve 403 em tudo. Recusar na criação é mais honesto.
    throw new ValidationError('Selecione ao menos um escopo.')
  }

  const prefix = randomBytes(8).toString('hex')
  const secret = randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('partner_api_keys' as never)
    .insert({
      partner_id: input.partnerId,
      name: input.name.trim(),
      key_prefix: prefix,
      key_hash: sha256(secret),
      scopes,
      allowed_ips: input.allowedIps ?? null,
      expires_at: input.expiresAt ?? null,
      created_by: actorId,
    } as never)
    .select(SAFE_COLUMNS)
    .single()
  if (error || !data) throw new Error(`issueApiKey failed: ${error?.message}`)

  logger.info(
    {
      event: 'partner_api_key.issued',
      actor_id: actorId,
      partner_id: input.partnerId,
      key_prefix: prefix,
      scopes,
    },
    'partner-api-key-issued',
  )

  return {
    key: mapRow(data as unknown as KeyRow),
    secret: `clinni_${prefix}_${secret}`,
  }
}

export async function listApiKeys(
  supabase: SupabaseClient<Database>,
  partnerId: string,
): Promise<PartnerApiKey[]> {
  const { data, error } = await supabase
    .from('partner_api_keys' as never)
    .select(SAFE_COLUMNS)
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listApiKeys failed: ${error.message}`)
  return ((data ?? []) as unknown as KeyRow[]).map(mapRow)
}

export async function revokeApiKey(
  supabase: SupabaseClient<Database>,
  actorId: string,
  keyId: string,
  reason?: string,
): Promise<void> {
  const { error } = await supabase
    .from('partner_api_keys' as never)
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: reason ?? null,
    } as never)
    .eq('id', keyId)
    .is('revoked_at', null)
  if (error) throw new Error(`revokeApiKey failed: ${error.message}`)

  logger.info(
    { event: 'partner_api_key.revoked', actor_id: actorId, key_id: keyId },
    'partner-api-key-revoked',
  )
}

export interface ResolvedKey {
  keyId: string
  partnerId: string
  scopes: PartnerScope[]
  allowedIps: string[] | null
}

/**
 * Autentica a chave apresentada. `null` = não autenticou, por qualquer motivo.
 *
 * O motivo NÃO é distinguido para quem chama: chave malformada, prefixo
 * inexistente, hash divergente e chave revogada devolvem todos `null`. Dizer
 * "esta chave existe mas está revogada" já confirma que o prefixo é válido.
 */
export async function resolveApiKey(
  supabase: SupabaseClient<Database>,
  raw: string,
): Promise<ResolvedKey | null> {
  const parsed = parseApiKey(raw)
  if (!parsed) return null

  const { data, error } = await supabase
    .from('partner_api_keys' as never)
    .select('id, partner_id, key_hash, scopes, revoked_at, expires_at, allowed_ips')
    .eq('key_prefix', parsed.prefix)
    .maybeSingle()
  if (error || !data) return null

  const row = data as unknown as {
    id: string
    partner_id: string
    key_hash: string
    scopes: string[] | null
    revoked_at: string | null
    expires_at: string | null
    allowed_ips: string[] | null
  }
  if (row.revoked_at) return null
  // Vencida é indistinguível de inválida, pelo mesmo motivo de revogada: dizer
  // "esta chave existe, só venceu" já confirma que o prefixo é bom.
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null

  const expected = Buffer.from(row.key_hash, 'hex')
  const actual = Buffer.from(sha256(parsed.secret), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  return {
    keyId: row.id,
    partnerId: row.partner_id,
    scopes: (row.scopes ?? []) as PartnerScope[],
    allowedIps: row.allowed_ips,
  }
}

/**
 * Carimba o último uso. Best-effort: falhar aqui NÃO pode derrubar a
 * requisição do parceiro — é telemetria, e a trilha que importa em LGPD é
 * `partner_api_access_log`, gravada em separado.
 */
export async function touchLastUsed(
  supabase: SupabaseClient<Database>,
  keyId: string,
): Promise<void> {
  try {
    await supabase
      .from('partner_api_keys' as never)
      .update({ last_used_at: new Date().toISOString() } as never)
      .eq('id', keyId)
  } catch {
    /* silencioso por desenho */
  }
}

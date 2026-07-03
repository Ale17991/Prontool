import { createHmac, timingSafeEqual } from 'node:crypto'
import { readGhlOAuthEnv } from './env'

/**
 * Feature 008 — Validação dos webhooks INSTALL/UNINSTALL do GHL Marketplace.
 *
 * Algoritmo (default razoável — ver research.md item 3,
 * needs-verification-against-official-docs):
 *
 *   sig = hex(HMAC_SHA256(GHL_MARKETPLACE_SHARED_SECRET, raw_body))
 *
 * Headers esperados:
 *   - x-wh-signature  → assinatura hex lowercase (preferido) ou base64
 *   - x-wh-timestamp  → epoch em segundos (anti-replay ±5 min)
 *
 * Em qualquer falha (timestamp ausente / fora da janela, assinatura
 * malformada, mismatch) lança `InvalidMarketplaceSignatureError`.
 *
 * Caller MUST passar o **raw body** (string), não o JSON parsado, para
 * que o HMAC bata com o que o GHL assinou.
 */

const ANTI_REPLAY_WINDOW_SECONDS = 5 * 60

export class InvalidMarketplaceSignatureError extends Error {
  readonly code = 'INVALID_SIGNATURE'
  readonly reason: string
  constructor(reason: string) {
    super(`Marketplace signature invalid: ${reason}`)
    this.name = 'InvalidMarketplaceSignatureError'
    this.reason = reason
  }
}

export interface MarketplaceSignatureHeaders {
  signature: string | null
  timestamp: string | null
}

/**
 * Lê os dois headers relevantes (case-insensitive) de um `Headers` obj.
 */
export function readMarketplaceSignatureHeaders(headers: Headers): MarketplaceSignatureHeaders {
  return {
    signature:
      headers.get('x-wh-signature') ??
      headers.get('x-ghl-signature') ?? // fallback caso GHL use prefixo legado
      null,
    timestamp: headers.get('x-wh-timestamp') ?? headers.get('x-ghl-timestamp') ?? null,
  }
}

/**
 * Valida a assinatura do raw body contra o segredo compartilhado.
 * Lança em qualquer caso de falha; sucesso retorna void.
 */
export function verifyMarketplaceSignature(args: {
  rawBody: string
  signature: string | null
  timestamp: string | null
  /** Override só para testes — produção sempre lê de env. */
  sharedSecret?: string
  nowMs?: number
}): void {
  const sharedSecret = args.sharedSecret ?? readGhlOAuthEnv().marketplaceSharedSecret
  const nowMs = args.nowMs ?? Date.now()

  if (!args.signature) throw new InvalidMarketplaceSignatureError('missing x-wh-signature')
  if (!args.timestamp) throw new InvalidMarketplaceSignatureError('missing x-wh-timestamp')

  const tsSeconds = Number.parseInt(args.timestamp, 10)
  if (!Number.isFinite(tsSeconds)) {
    throw new InvalidMarketplaceSignatureError('x-wh-timestamp not numeric')
  }
  const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - tsSeconds)
  if (skewSeconds > ANTI_REPLAY_WINDOW_SECONDS) {
    throw new InvalidMarketplaceSignatureError(
      `timestamp skew ${skewSeconds}s outside window ${ANTI_REPLAY_WINDOW_SECONDS}s`,
    )
  }

  const expected = computeHmacHex(sharedSecret, args.rawBody)
  const provided = args.signature.trim().toLowerCase()
  if (provided.length !== expected.length) {
    throw new InvalidMarketplaceSignatureError('signature length mismatch')
  }
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidMarketplaceSignatureError('signature mismatch')
  }
}

function computeHmacHex(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex').toLowerCase()
}

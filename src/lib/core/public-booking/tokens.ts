/**
 * Feature 017 — Tokens de cancelamento de booking público.
 *
 * Padrão: 32 bytes via `crypto.randomBytes` → base64url. Hash SHA-256 (hex)
 * persistido em `public_booking_tokens.token_hash`. O raw só circula no
 * email do paciente e na resposta 201 imediata; nunca em logs nem no DB.
 *
 * Verificação usa `crypto.timingSafeEqual` para evitar leak por timing.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

export interface BookingTokenPair {
  raw: string
  hash: string
}

/** Gera um par raw+hash para um novo token de cancelamento. */
export function generateCancelToken(): BookingTokenPair {
  const raw = randomBytes(32).toString('base64url')
  const hash = hashToken(raw)
  return { raw, hash }
}

/** SHA-256 hex do token raw. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Compara um token raw recebido (URL) com um hash armazenado em DB,
 * em tempo constante. Retorna false se tamanhos divergem (não joga).
 */
export function safeCompareHash(rawIncoming: string, hashExpected: string): boolean {
  const incomingHash = hashToken(rawIncoming)
  const a = Buffer.from(incomingHash, 'hex')
  const b = Buffer.from(hashExpected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

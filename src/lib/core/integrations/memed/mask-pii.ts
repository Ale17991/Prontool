/**
 * Mascaramento para a cápsula Memed (Feature 026 / conformidade 027).
 *
 * Dois níveis:
 *  - SEGREDOS (api_key, secret_key, token JWT do prescritor): substituídos
 *    inteiramente por `***REDACTED***`. A Memed pode considerar QUALQUER
 *    caractere exposto da chave como vazamento (FR-012 / research R2), então
 *    nunca mostramos prefixo/sufixo de segredo.
 *  - PII de paciente (CPF, telefone, email): reusa os helpers de
 *    `@/lib/utils/mask-pii` (mantém prefixo/sufixo curto para debug).
 */

import { maskCpf, maskEmail, maskPhone } from '@/lib/utils/mask-pii'

export { maskCpf, maskEmail, maskPhone }

export const REDACTED = '***REDACTED***'

/** Segredo presente → `***REDACTED***`; ausente → string vazia. */
export function redactSecret(value: unknown): string {
  return value === undefined || value === null || value === '' ? '' : REDACTED
}

/** Chaves cujo VALOR é sempre segredo, em qualquer objeto logado. */
const SECRET_KEYS = new Set([
  'api_key',
  'secret_key',
  'api-key',
  'secret-key',
  'apiKey',
  'secretKey',
  'token',
  'access_token',
  'password',
])

/** Chaves que carregam PII de paciente (mascaramento parcial). */
const PII_MASKERS: Record<string, (v: string) => string> = {
  cpf: maskCpf,
  email: maskEmail,
  telefone: maskPhone,
  phone: maskPhone,
}

/**
 * Varre recursivamente um objeto (payload, detail de log) e devolve uma cópia
 * com segredos `***REDACTED***` e PII mascarada. Seguro para passar ao Pino.
 */
export function redactMemedDetail(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(redactMemedDetail)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) {
        out[k] = redactSecret(v)
      } else if (typeof v === 'string' && PII_MASKERS[k]) {
        out[k] = PII_MASKERS[k]!(v)
      } else {
        out[k] = redactMemedDetail(v)
      }
    }
    return out
  }
  return value
}

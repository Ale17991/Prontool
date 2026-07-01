/**
 * Feature 029 — masking de PII e segredos para logs do módulo TISS.
 *
 * Constituição (Domínio/LGPD): logs NÃO podem conter dados sensíveis (nome,
 * carteira, CPF) nem segredos (certificado .pfx, senha) em texto claro. Use
 * `maskTissForLog` antes de logar qualquer objeto que possa carregá-los.
 */

/** Chaves cujo VALOR deve ser totalmente redatado (segredo/PII). */
const SENSITIVE_KEY =
  /(pfx|password|senha|secret|api[_-]?key|card[_-]?number|carteira|cpf|beneficiary|full_name|_enc$)/i

/** Mascara um valor textual preservando só extremidades para correlação. */
export function maskValue(value: string): string {
  if (!value) return value
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

/**
 * Redige recursivamente um objeto para log: chaves sensíveis viram '[REDACTED]';
 * Buffers/Uint8Array nunca são serializados.
 */
export function maskTissForLog(input: unknown): unknown {
  if (input === null || input === undefined) return input
  if (typeof input === 'string') return input
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) return '[bytes]'
  if (Array.isArray(input)) return input.map(maskTissForLog)
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = '[REDACTED]'
      } else if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
        out[k] = '[bytes]'
      } else if (typeof v === 'object') {
        out[k] = maskTissForLog(v)
      } else {
        out[k] = v
      }
    }
    return out
  }
  return input
}

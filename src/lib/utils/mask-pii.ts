/**
 * Helpers de mascaramento de PII para logs e summaries que ficam visíveis
 * em UI (ex.: `integration_sync_log` da Feature 008). Constituição §IV /
 * LGPD: dados pessoais não devem aparecer em texto claro fora do contexto
 * de consulta autorizado pelo paciente/clínica.
 */

/**
 * `123.456.789-01` → `***.456.789-**`
 * Aceita CPF com ou sem máscara; entrada inválida retorna placeholder
 * `***.***.***-**` para preservar segurança.
 */
export function maskCpf(value: string | null | undefined): string {
  if (!value) return '***.***.***-**'
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return '***.***.***-**'
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`
}

/**
 * Telefone — mantém prefixo (`+55`, DDD) e sufixo curto, mascara o miolo.
 * Entrada inválida → `***-****`.
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '***-****'
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return '***-****'
  // Mantém últimos 4 dígitos visíveis. Prefixo cresce com o número.
  const tail = digits.slice(-4)
  if (digits.length <= 10) {
    // BR sem +55: AABBBBCCCC ou AABBBBBCCCC
    return `(${digits.slice(0, 2)}) ****-${tail}`
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits[2]}****-${tail}`
  }
  // Internacional: +55 11 9...-XXXX
  const cc = digits.slice(0, digits.length - 11)
  const ddd = digits.slice(cc.length, cc.length + 2)
  return `+${cc} ${ddd} *****-${tail}`
}

/**
 * Email — preserva primeira letra do user e domínio.
 * `maria.silva@example.com` → `m****@example.com`.
 */
export function maskEmail(value: string | null | undefined): string {
  if (!value || !value.includes('@')) return '***@***'
  const [user, domain] = value.split('@', 2)
  if (!user || !domain) return '***@***'
  if (user.length === 0) return `***@${domain}`
  return `${user[0]}****@${domain}`
}

/**
 * Aplica masking a um objeto `detail` antes de gravá-lo em
 * `integration_sync_log.detail` ou logar via Pino. Faz cópia rasa:
 * substitui campos conhecidos (cpf, email, phone, full_name) sem
 * tocar no resto.
 */
export function redactDetailPii<T extends Record<string, unknown>>(detail: T): T {
  const out = { ...detail } as Record<string, unknown>
  if (typeof out.cpf === 'string') out.cpf = maskCpf(out.cpf)
  if (typeof out.email === 'string') out.email = maskEmail(out.email)
  if (typeof out.phone === 'string') out.phone = maskPhone(out.phone)
  if (typeof out.full_name === 'string') out.full_name = redactName(out.full_name)
  if (typeof out.patient_name === 'string') out.patient_name = redactName(out.patient_name)
  return out as T
}

function redactName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0) return '***'
  const first = parts[0] ?? ''
  if (parts.length === 1) return `${first[0] ?? '*'}***`
  return `${first} ${parts
    .slice(1)
    .map((p) => `${p[0] ?? '*'}***`)
    .join(' ')}`
}

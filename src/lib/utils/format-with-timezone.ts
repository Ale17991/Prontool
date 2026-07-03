/**
 * Helpers de formatação respeitando o fuso horário escolhido pelo usuário.
 *
 * Princípio constitucional §"Relógio": persistência em UTC, conversão na
 * camada de apresentação. Estes helpers são a camada de apresentação.
 */

export function formatDateTimeInTz(
  input: Date | string | null | undefined,
  timezone: string,
): string {
  if (!input) return '—'
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function formatDateInTz(input: Date | string | null | undefined, timezone: string): string {
  if (!input) return '—'
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { timeZone: timezone })
}

export function formatTimeInTz(input: Date | string | null | undefined, timezone: string): string {
  if (!input) return '—'
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
}

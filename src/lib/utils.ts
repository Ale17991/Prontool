import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Concatena classes Tailwind respeitando precedência (cn padrão shadcn). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Centavos → "R$ 1.234,56" pt-BR. */
export function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

/** Basis points → "40,00%". */
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  return `${(bps / 100).toFixed(2)}%`
}

/** ISO timestamp → "17/04/2026 14:32" pt-BR. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** ISO date or timestamp → "17/04/2026" pt-BR. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** YYYY-MM-DD → idade em anos. */
export function calculateAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/** Bytes → "1.5 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
}

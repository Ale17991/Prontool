import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,59}$/

/**
 * Feature 010 (US2) — Geração de slug para nome de clínica no onboarding.
 *
 * - Normaliza acento via NFD + strip combining marks.
 * - Lowercase.
 * - Espaços e qualquer caractere fora de [a-z0-9] viram hífen.
 * - Hífens consecutivos colapsam para um.
 * - Hífens nas pontas removidos.
 * - Truncado em 60 chars (limite de banco e legibilidade).
 *
 * Retorna string vazia se a normalização não deixou nenhum caractere válido —
 * caller decide o fallback (ex.: "clinica-{timestamp}").
 */
export function slugify(name: string): string {
  if (typeof name !== 'string') return ''
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return normalized
}

export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && SLUG_REGEX.test(slug)
}

/**
 * Encontra um slug livre a partir de `base`. Tenta `base`, `base-2`, ...
 * até `base-100`. Throw se exhausto — caller pode pedir input diferente.
 */
export async function nextAvailableSlug(
  supabase: SupabaseClient<Database>,
  base: string,
): Promise<string> {
  const sanitized = slugify(base)
  if (!sanitized) {
    return `clinica-${Date.now().toString(36)}`
  }
  for (let i = 1; i <= 100; i++) {
    const candidate = i === 1 ? sanitized : `${sanitized.slice(0, 57)}-${i}`
    const { data, error } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (error) {
      throw new Error(`nextAvailableSlug query failed: ${error.message}`)
    }
    if (!data) return candidate
  }
  throw new Error('nextAvailableSlug: 100 candidates exhausted')
}

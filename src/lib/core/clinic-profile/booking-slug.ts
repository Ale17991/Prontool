/**
 * Validação do slug do portal de agendamento público (`public_booking_slug`).
 *
 * Reaproveitado pela tela de configurações da clínica (PUT) e pela checagem de
 * disponibilidade em tempo real (onBlur). A coluna já tem CHECK
 * `^[a-z0-9][a-z0-9-]{2,31}$` e UNIQUE parcial no banco — aqui validamos antes,
 * com mensagens amigáveis, e bloqueamos slugs reservados pelo roteamento.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/** Slugs que colidem com rotas do sistema e não podem ser usados por clínicas. */
export const RESERVED_SLUGS = [
  'novo',
  'admin',
  'api',
  'login',
  'registrar',
  'configuracoes',
  'operacao',
  'analise',
] as const

/** Mesma regex da CHECK constraint: começa com letra/dígito; 3–32 chars. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,31}$/

export type BookingSlugResult =
  | { ok: true; slug: string | null }
  | { ok: false; reason: string }

/**
 * Normaliza (trim + lowercase) e valida formato + reservados.
 * `''`/`null`/`undefined` → `{ ok: true, slug: null }` (portal desativado).
 */
export function normalizeBookingSlug(raw: string | null | undefined): BookingSlugResult {
  if (raw === null || raw === undefined) return { ok: true, slug: null }
  const slug = raw.trim().toLowerCase()
  if (slug === '') return { ok: true, slug: null }
  if (slug.length < 3) {
    return { ok: false, reason: 'O link deve ter ao menos 3 caracteres.' }
  }
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason:
        'Use apenas letras minúsculas, números e hífens (sem espaços), começando por letra ou número. Máximo 32 caracteres.',
    }
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
    return { ok: false, reason: 'Este link é reservado pelo sistema. Escolha outro.' }
  }
  return { ok: true, slug }
}

/** `true` se OUTRA clínica (tenant) já usa este slug. */
export async function isBookingSlugTaken(
  supabase: SupabaseClient<Database>,
  slug: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('tenant_clinic_profile')
    .select('tenant_id')
    .eq('public_booking_slug', slug)
    .neq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`isBookingSlugTaken: ${error.message}`)
  return data !== null
}

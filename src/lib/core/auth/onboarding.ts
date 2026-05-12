import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'
import { isValidSlug, nextAvailableSlug, slugify } from './slug'

/**
 * Feature 010 (US2) — Criação atômica do primeiro tenant (R3 + R7).
 *
 * Chama RPC `create_first_tenant` (SECURITY DEFINER) que insere em
 * tenants + user_tenants(role=admin) + user_active_tenant + lazy
 * tenant_clinic_profile. Atomicidade garantida por transação SQL.
 *
 * O caller (route handler) é responsável por:
 *   - garantir que o usuário ainda não tem vínculo ativo (409
 *     already_has_tenant)
 *   - fazer audit com `entity='tenants', field='create'`
 *   - chamar `auth.admin.updateUserById` para setar
 *     user_metadata.active_tenant_id (assim o auth_hook resolve o tenant
 *     na próxima refreshSession)
 */

export const onboardingSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  cnpj: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(20).optional(),
})

export type OnboardingInput = z.infer<typeof onboardingSchema>

export interface OnboardingResult {
  tenantId: string
  slug: string
  name: string
}

const MAX_SLUG_RETRIES = 3

export async function createFirstTenant(
  supabase: SupabaseClient<Database>,
  userId: string,
  rawInput: unknown,
): Promise<OnboardingResult> {
  const parsed = onboardingSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'invalid onboarding payload', {
      issues: parsed.error.issues,
    })
  }
  const { name, slug: requestedSlug, cnpj, phone } = parsed.data

  // Resolução do slug:
  //   - se o caller mandou explícito, valida formato e tenta esse antes;
  //     em colisão, sufixa numérico via nextAvailableSlug.
  //   - sem slug, deriva de `name` via nextAvailableSlug (com sufixo se
  //     necessário).
  let baseCandidate: string
  if (requestedSlug && requestedSlug.length > 0) {
    if (!isValidSlug(requestedSlug)) {
      throw new ValidationError(
        'Slug inválido. Use apenas letras minúsculas, dígitos e hífens (3 a 60 chars).',
        { field: 'slug' },
      )
    }
    baseCandidate = requestedSlug
  } else {
    const fromName = slugify(name)
    baseCandidate = fromName.length > 0 ? fromName : `clinica-${Date.now().toString(36)}`
  }

  let effectiveSlug = await nextAvailableSlug(supabase, baseCandidate)

  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.rpc('create_first_tenant', {
        p_user_id: userId,
        p_name: name,
        p_slug: effectiveSlug,
        p_cnpj: cnpj ?? undefined,
        p_phone: phone ?? undefined,
      })
      if (error) {
        // Race com outro tenant criado entre nextAvailableSlug e a RPC →
        // unique_violation no slug. Tenta o próximo livre.
        if (error.code === '23505') {
          effectiveSlug = await nextAvailableSlug(
            supabase,
            `${baseCandidate.slice(0, 56)}-r${attempt + 2}`,
          )
          continue
        }
        throw new Error(`create_first_tenant RPC failed: ${error.message}`)
      }
      const tenantId = data as unknown as string
      if (!tenantId) {
        throw new Error('create_first_tenant returned empty tenant_id')
      }
      return { tenantId, slug: effectiveSlug, name: name.trim() }
    } catch (err) {
      if (attempt === MAX_SLUG_RETRIES - 1) throw err
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), attempt },
        'onboarding-create-first-tenant-retry',
      )
    }
  }
  throw new ConflictError('SLUG_EXHAUSTED', 'Não foi possível gerar slug livre. Tente outro nome.')
}

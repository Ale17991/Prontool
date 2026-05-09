import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { getUserProfile } from './read'
import type { UserProfile } from './types'

let cachedTimezones: Set<string> | null = null

function supportedTimezones(): Set<string> {
  if (cachedTimezones) return cachedTimezones
  // Intl.supportedValuesOf é o catálogo IANA local (Node 18+).
  const list = (Intl as unknown as {
    supportedValuesOf?: (key: string) => string[]
  }).supportedValuesOf?.('timeZone')
  cachedTimezones = new Set(list ?? ['America/Sao_Paulo', 'UTC'])
  return cachedTimezones
}

export const userProfilePatchSchema = z.object({
  fullName: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? undefined))),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .refine((v) => v == null || supportedTimezones().has(v), {
      message: 'Fuso horário inválido',
    }),
  // Defesa: rejeita explicitamente tentativa de mudar email aqui.
  email: z.never().optional() as unknown as z.ZodType<undefined>,
})

export type UserProfilePatch = z.infer<typeof userProfilePatchSchema>

interface UpdateContext {
  ip?: string | null
  userAgent?: string | null
}

/**
 * Atualiza nome / timezone do perfil. Cada campo alterado vira uma linha
 * em audit_log (Constituição §II).
 */
export async function updateUserProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string | null,
  patchInput: unknown,
  context: UpdateContext = {},
): Promise<UserProfile> {
  const parsed = userProfilePatchSchema.safeParse(patchInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'invalid user profile patch', {
      issues: parsed.error.issues,
    })
  }
  const patch = parsed.data

  const current = await getUserProfile(supabase, userId, email, 0)
  type UpdateRow = Database['public']['Tables']['user_profile']['Update']
  const updates: UpdateRow = {}
  const auditRows: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

  if ('fullName' in patch && patch.fullName !== undefined) {
    const next = patch.fullName ?? null
    if (next !== current.fullName) {
      updates.full_name = next
      auditRows.push({ field: 'full_name', oldValue: current.fullName, newValue: next })
    }
  }
  if (patch.timezone && patch.timezone !== current.timezone) {
    updates.timezone = patch.timezone
    auditRows.push({ field: 'timezone', oldValue: current.timezone, newValue: patch.timezone })
  }

  if (Object.keys(updates).length === 0) return current

  // Garante que a row existe antes de update.
  const { error: updateError } = await supabase
    .from('user_profile')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' })
  if (updateError) {
    throw new Error(`updateUserProfile failed: ${updateError.message}`)
  }

  const tenantIdForAudit = await getActiveTenantForUser(supabase, userId)
  await Promise.all(
    auditRows.map(async ({ field, oldValue, newValue }) => {
      const { error } = await supabase.from('audit_log').insert({
        tenant_id: tenantIdForAudit,
        actor_id: userId,
        actor_label: email,
        entity: 'user_profile',
        entity_id: userId,
        field,
        old_value: oldValue,
        new_value: newValue,
        reason: 'updated via /api/configuracoes/perfil PUT',
        ip: context.ip ?? null,
        user_agent: context.userAgent ?? null,
        result: 'success',
      })
      if (error) console.error('updateUserProfile audit insert failed', { field, error })
    }),
  )

  return getUserProfile(supabase, userId, email)
}

async function getActiveTenantForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  return (data?.tenant_id as string | undefined) ?? userId
}

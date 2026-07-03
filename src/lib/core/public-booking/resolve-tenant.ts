/**
 * Feature 017 — Resolve um slug público para os dados públicos do tenant.
 *
 * Usa RPC `public_booking_resolve_slug` (SECURITY INVOKER): a policy
 * `tenant_clinic_profile_public_slug_read` em anon filtra por
 * `public_booking_enabled = TRUE`. Slug inválido / disabled retornam null.
 *
 * Não expõe CNPJ, email, tech_responsible — apenas o que o paciente
 * precisa ver na landing pública.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { ResolvedTenant } from './types'

export async function resolveTenantBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<ResolvedTenant | null> {
  const { data, error } = await supabase.rpc(
    'public_booking_resolve_slug' as never,
    { p_slug: slug } as never,
  )
  if (error) {
    throw new Error(`resolveTenantBySlug failed: ${error.message}`)
  }
  const rows =
    (data as unknown as Array<{
      tenant_id: string
      display_name: string
      logo_path: string | null
      phone: string | null
      address_line: string | null
      min_hours_advance: number
      max_days_advance: number
      cancel_min_hours: number
    }> | null) ?? []
  const row = rows[0]
  if (!row) return null
  return {
    tenantId: row.tenant_id,
    displayName: row.display_name,
    logoPath: row.logo_path,
    phone: row.phone,
    addressLine: row.address_line,
    minHoursAdvance: row.min_hours_advance,
    maxDaysAdvance: row.max_days_advance,
    cancelMinHours: row.cancel_min_hours,
  }
}

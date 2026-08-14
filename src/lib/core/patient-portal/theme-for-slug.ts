import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { resolvePortalTheme, type PortalTheme } from './theme'

/**
 * Feature 058 — a paleta da clínica pelo endereço público, e só ela.
 *
 * Existe separada de `resolvePortalClinicBySlug` porque o layout do portal
 * precisa da cor em toda página, e aquela função resolve muito mais: nome de
 * exibição (que pode custar uma segunda consulta a `tenants`) e URL ASSINADA do
 * logo, que é uma ida ao Storage. Pagar isso duas vezes por acesso para pintar
 * um fundo seria caro à toa.
 *
 * Respeita o mesmo liga/desliga: clínica com o portal desabilitado não existe
 * para fora, e portanto não tem cor para fora.
 */
export async function getPortalThemeBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<PortalTheme | null> {
  const { data, error } = await supabase
    .from('tenant_clinic_profile')
    .select('patient_portal_enabled, portal_brand_color, portal_surface_color')
    .eq('public_booking_slug', slug)
    .maybeSingle()
  if (error || !data) return null
  // Colunas da 0204, ainda fora dos tipos gerados → cast solto.
  const row = data as unknown as {
    patient_portal_enabled: boolean | null
    portal_brand_color: string | null
    portal_surface_color: string | null
  }
  if (!row.patient_portal_enabled) return null
  return resolvePortalTheme(row.portal_brand_color, row.portal_surface_color)
}

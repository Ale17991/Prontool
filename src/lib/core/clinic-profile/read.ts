import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'
import {
  CLINIC_LOGO_BUCKET,
  CLINIC_LOGO_SIGNED_URL_TTL_SECONDS,
  type ClinicProfile,
} from './types'

type Row = Database['public']['Tables']['tenant_clinic_profile']['Row']

function syntheticEmptyRow(tenantId: string): Row {
  const now = new Date().toISOString()
  return {
    tenant_id: tenantId,
    logo_path: null,
    logo_uploaded_at: null,
    corporate_name: null,
    cnpj: null,
    phone: null,
    email: null,
    address_cep: null,
    address_street: null,
    address_number: null,
    address_complement: null,
    address_neighborhood: null,
    address_city: null,
    address_uf: null,
    tech_responsible_name: null,
    tech_responsible_council: null,
    tech_responsible_registration: null,
    // Feature 017 — defaults consistentes com a migration 0093.
    public_booking_slug: null,
    public_booking_enabled: false,
    public_booking_min_hours_advance: 24,
    public_booking_max_days_advance: 30,
    public_booking_cancel_min_hours: 6,
    // Feature 018 — defaults consistentes com a migration 0094.
    reminder_enabled: false,
    reminder_offsets_hours: [24],
    reminder_send_weekends: true,
    reminder_window_start: '08:00:00',
    reminder_window_end: '20:00:00',
    reminder_template_subject: null,
    reminder_template_body: null,
    reminder_last_run_at: null,
    created_at: now,
    updated_at: now,
  }
}

function rowToProfile(
  row: Row,
  signedLogoUrl: string | null,
  displayName: string | null,
): ClinicProfile {
  return {
    tenantId: row.tenant_id,
    displayName,
    logo: row.logo_path
      ? {
          path: row.logo_path,
          signedUrl: signedLogoUrl,
          uploadedAt: row.logo_uploaded_at ?? row.updated_at,
        }
      : null,
    corporateName: row.corporate_name,
    cnpj: row.cnpj,
    phone: row.phone,
    email: row.email,
    address: {
      cep: row.address_cep,
      street: row.address_street,
      number: row.address_number,
      complement: row.address_complement,
      neighborhood: row.address_neighborhood,
      city: row.address_city,
      uf: row.address_uf,
    },
    techResponsible: {
      name: row.tech_responsible_name,
      council: row.tech_responsible_council,
      registration: row.tech_responsible_registration,
    },
    updatedAt: row.updated_at,
  }
}

/**
 * Lê o perfil da clínica de um tenant. Cria a row vazia (lazy) na primeira
 * leitura para que o admin não veja "não encontrado" — apenas campos null
 * para preencher.
 *
 * Aceita qualquer client (RLS-bound ou service-role). Quando RLS-bound,
 * o caller é responsável por garantir que `tenantId` corresponde ao
 * `jwt_tenant_id` (em geral via `getSession()`).
 */
export async function getClinicProfile(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  signedUrlTtl: number = CLINIC_LOGO_SIGNED_URL_TTL_SECONDS,
): Promise<ClinicProfile> {
  const { data: existing, error: selectError } = await supabase
    .from('tenant_clinic_profile')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (selectError) throw new Error(`getClinicProfile select failed: ${selectError.message}`)

  let row = existing as Row | null
  if (!row) {
    const { data: inserted, error: insertError } = await supabase
      .from('tenant_clinic_profile')
      .insert({ tenant_id: tenantId })
      .select('*')
      .maybeSingle()

    if (insertError) {
      // Cenário esperado para roles não-admin (RLS INSERT exige admin).
      // Tenta uma re-leitura — se outro request criou no meio, devolve;
      // caso contrário, devolve uma row sintética vazia para que o caller
      // (sidebar/layout) consiga renderizar o fallback graciosamente.
      const { data: reread } = await supabase
        .from('tenant_clinic_profile')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      row = (reread as Row | null) ?? syntheticEmptyRow(tenantId)
    } else {
      row = inserted as Row
    }
  }

  const [signedLogoUrl, tenantRow] = await Promise.all([
    createSignedUrlOrNull(supabase, CLINIC_LOGO_BUCKET, row.logo_path, signedUrlTtl),
    fetchTenantName(supabase, tenantId),
  ])
  return rowToProfile(row, signedLogoUrl, tenantRow)
}

async function fetchTenantName(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle()
    return data?.name ?? null
  } catch {
    return null
  }
}

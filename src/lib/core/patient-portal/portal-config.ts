/**
 * Feature 030 — configuração admin do Portal do Paciente (config 0114).
 *
 * Server-side only. Lê/escreve:
 *   - `tenant_clinic_profile.patient_portal_enabled` (liga/desliga)
 *   - `tenant_clinic_profile.public_booking_slug` (endereço público — o mesmo
 *     do agendamento; é a identidade pública única da clínica)
 *   - `tenant_patient_metric_settings` (quais métricas a clínica expõe)
 *
 * Constituição:
 *   - III multi-tenant: tenantId vem da sessão, nunca do cliente.
 *   - V RBAC: chamadores precisam da action `patient_portal.config` (admin).
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listMetricTypes, type PatientMetricType } from './metric-types'

// Mesma regex/limites do slug do agendamento público (CHECK constraint).
const slugSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]{2,31}$/, {
    message:
      'Endereço deve ter 3-32 caracteres, começar com letra ou dígito, e conter apenas letras minúsculas, dígitos e hífens.',
  })

export const PatientPortalConfigUpdateSchema = z
  .object({
    patientPortalEnabled: z.boolean(),
    publicBookingSlug: slugSchema.nullable(),
  })
  .refine((v) => !v.patientPortalEnabled || v.publicBookingSlug !== null, {
    message: 'Para habilitar o portal, defina o endereço (slug).',
    path: ['patientPortalEnabled'],
  })

export type PatientPortalConfigUpdate = z.infer<typeof PatientPortalConfigUpdateSchema>

export interface PatientPortalConfig {
  patientPortalEnabled: boolean
  /** Endereço público — compartilhado com o agendamento online. */
  publicBookingSlug: string | null
}

export interface MetricSetting extends PatientMetricType {
  /** true = visível para a clínica (default quando não há override). */
  enabled: boolean
}

// =========================================================================
// Read
// =========================================================================

export async function getPatientPortalConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PatientPortalConfig> {
  const { data, error } = await supabase
    .from('tenant_clinic_profile')
    .select('patient_portal_enabled, public_booking_slug')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getPatientPortalConfig: ${error.message}`)
  const row = data as
    | { patient_portal_enabled: boolean | null; public_booking_slug: string | null }
    | null
  return {
    patientPortalEnabled: row?.patient_portal_enabled ?? false,
    publicBookingSlug: row?.public_booking_slug ?? null,
  }
}

/** Catálogo (por especialidade) com o flag enabled resolvido por clínica. */
export async function listMetricSettings(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  args: { specialty?: string } = {},
): Promise<MetricSetting[]> {
  const [types, settingsRes] = await Promise.all([
    listMetricTypes(supabase, { ...args, tenantId }),
    supabase
      .from('tenant_patient_metric_settings')
      .select('metric_type, enabled')
      .eq('tenant_id', tenantId),
  ])
  if (settingsRes.error) {
    throw new Error(`listMetricSettings: ${settingsRes.error.message}`)
  }
  const override = new Map(
    ((settingsRes.data ?? []) as Array<{ metric_type: string; enabled: boolean }>).map((s) => [
      s.metric_type,
      s.enabled,
    ]),
  )
  return types.map((t) => ({ ...t, enabled: override.get(t.metricType) ?? true }))
}

// =========================================================================
// Mutations — tenantId sempre da sessão; RBAC garantido pelo caller.
// =========================================================================

export async function updatePatientPortalConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: PatientPortalConfigUpdate,
): Promise<void> {
  // Slug é único entre clínicas (DB já tem índice unique; checagem explícita
  // dá erro amigável). Compartilhado com o agendamento público.
  if (input.publicBookingSlug !== null) {
    const { data: conflict, error: conflictError } = await supabase
      .from('tenant_clinic_profile')
      .select('tenant_id')
      .eq('public_booking_slug', input.publicBookingSlug)
      .neq('tenant_id', tenantId)
      .maybeSingle()
    if (conflictError) {
      throw new Error(`updatePatientPortalConfig slug check: ${conflictError.message}`)
    }
    if (conflict) throw new Error('SLUG_ALREADY_TAKEN')
  }

  // Upsert: cria a linha do perfil se ainda não existe; atualiza só estas
  // colunas (demais campos de perfil/booking ficam intactos).
  const { error } = await supabase.from('tenant_clinic_profile').upsert(
    {
      tenant_id: tenantId,
      patient_portal_enabled: input.patientPortalEnabled,
      public_booking_slug: input.publicBookingSlug,
    } as never,
    { onConflict: 'tenant_id' },
  )
  if (error) throw new Error(`updatePatientPortalConfig: ${error.message}`)
}

/** Liga/desliga uma métrica para a clínica (upsert idempotente). */
export async function setMetricEnabled(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  metricType: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.from('tenant_patient_metric_settings').upsert(
    {
      tenant_id: tenantId,
      metric_type: metricType,
      enabled,
    } as never,
    { onConflict: 'tenant_id,metric_type' },
  )
  if (error) throw new Error(`setMetricEnabled: ${error.message}`)
}

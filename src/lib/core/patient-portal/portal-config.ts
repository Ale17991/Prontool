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

/**
 * Feature 057 — recado exibido na tela inicial do portal quando o paciente não
 * tem metas nem checklist.
 *
 * Vazio e só-espaços viram `null`: "apagou o texto" e "nunca escreveu" são o
 * mesmo estado, e guardar `''` criaria um terceiro — indistinguível na leitura,
 * distinguível no banco, e visível meses depois num relatório.
 *
 * O teto de 1.000 caracteres é da aplicação de propósito: a tela existe para ser
 * curta, e isso é regra de produto, não de schema.
 */
const welcomeTextSchema = z
  .string()
  .max(1000, { message: 'O texto de boas-vindas deve ter no máximo 1.000 caracteres.' })
  .nullable()
  .transform((v) => {
    const trimmed = v?.trim() ?? ''
    return trimmed.length > 0 ? trimmed : null
  })

export const PatientPortalConfigUpdateSchema = z
  .object({
    patientPortalEnabled: z.boolean(),
    publicBookingSlug: slugSchema.nullable(),
    welcomeText: welcomeTextSchema.optional(),
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
  /** Recado da tela inicial (057). `null` = a clínica nunca escreveu nada. */
  welcomeText: string | null
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
    .select('patient_portal_enabled, public_booking_slug, patient_portal_welcome_text')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getPatientPortalConfig: ${error.message}`)
  // Coluna da 0202, ainda fora dos tipos gerados → cast solto (mesmo padrão da
  // `login.ts` e das tabelas novas do projeto).
  const row = data as unknown as {
    patient_portal_enabled: boolean | null
    public_booking_slug: string | null
    patient_portal_welcome_text: string | null
  } | null
  return {
    patientPortalEnabled: row?.patient_portal_enabled ?? false,
    publicBookingSlug: row?.public_booking_slug ?? null,
    welcomeText: row?.patient_portal_welcome_text ?? null,
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
  // `welcomeText` ausente no payload = "não mexi nesse campo"; presente e nulo =
  // "apaguei". Sem essa distinção, qualquer tela que salvasse só o liga/desliga
  // limparia o recado da clínica sem ninguém pedir.
  const patch: Record<string, unknown> = {
    tenant_id: tenantId,
    patient_portal_enabled: input.patientPortalEnabled,
    public_booking_slug: input.publicBookingSlug,
  }
  if (input.welcomeText !== undefined) {
    patch.patient_portal_welcome_text = input.welcomeText
  }

  const { error } = await supabase
    .from('tenant_clinic_profile')
    .upsert(patch as never, { onConflict: 'tenant_id' })
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

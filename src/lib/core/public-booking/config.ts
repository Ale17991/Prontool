/**
 * Feature 017 — Configuração de agendamento público por tenant.
 *
 * Server-side only. Lê/escreve em `tenant_clinic_profile` (5 colunas
 * da feature), `public_booking_doctors`, `public_booking_doctor_procedures`.
 *
 * Validação:
 * - Slug: `^[a-z0-9][a-z0-9-]{2,31}$` (mesma regex da CHECK constraint).
 * - Janelas dentro de limites da CHECK constraint.
 * - available_weekdays: array com valores 0..6 (trigger no DB também valida).
 *
 * Constituição:
 * - II auditoria: cada UPDATE/INSERT/DELETE gera audit_log via trigger DB.
 * - III multi-tenant: tenant_id derivado da sessão, nunca do client.
 * - V RBAC: chamadores devem ter action `public_booking.config`.
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

// =========================================================================
// Schemas Zod (validação inline)
// =========================================================================

const slugSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]{2,31}$/, {
    message:
      'Slug deve ter 3-32 caracteres, começar com letra ou dígito, e conter apenas letras minúsculas, dígitos e hífens.',
  })

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, {
  message: 'Hora inválida. Use HH:MM (24h).',
})

const weekdaySchema = z
  .number()
  .int()
  .min(0)
  .max(6)

export const PublicBookingConfigUpdateSchema = z
  .object({
    publicBookingSlug: slugSchema.nullable(),
    publicBookingEnabled: z.boolean(),
    publicBookingMinHoursAdvance: z.number().int().min(0).max(168),
    publicBookingMaxDaysAdvance: z.number().int().min(1).max(180),
    publicBookingCancelMinHours: z.number().int().min(0).max(168),
  })
  .refine((v) => !v.publicBookingEnabled || v.publicBookingSlug !== null, {
    message: 'Para habilitar o agendamento público, defina um slug.',
    path: ['publicBookingEnabled'],
  })

export type PublicBookingConfigUpdate = z.infer<typeof PublicBookingConfigUpdateSchema>

export const PublishedDoctorUpsertSchema = z
  .object({
    doctorId: z.string().uuid(),
    displayOrder: z.number().int().min(0).default(0),
    bio: z.string().max(500).nullable(),
    availableWeekdays: z
      .array(weekdaySchema)
      .min(1)
      .max(7),
    availableFrom: timeSchema,
    availableUntil: timeSchema,
    lunchBreakFrom: timeSchema.nullable(),
    lunchBreakUntil: timeSchema.nullable(),
  })
  .refine((v) => v.availableUntil > v.availableFrom, {
    message: 'Hora final deve ser maior que hora inicial.',
    path: ['availableUntil'],
  })
  .refine(
    (v) =>
      (v.lunchBreakFrom === null && v.lunchBreakUntil === null) ||
      (v.lunchBreakFrom !== null && v.lunchBreakUntil !== null),
    {
      message: 'Pausa de almoço requer hora inicial E final, ou nenhum dos dois.',
      path: ['lunchBreakFrom'],
    },
  )
  .refine(
    (v) =>
      v.lunchBreakFrom === null ||
      v.lunchBreakUntil === null ||
      (v.lunchBreakUntil > v.lunchBreakFrom &&
        v.lunchBreakFrom >= v.availableFrom &&
        v.lunchBreakUntil <= v.availableUntil),
    {
      message:
        'Pausa de almoço deve estar dentro da janela de atendimento e ter fim maior que início.',
      path: ['lunchBreakFrom'],
    },
  )

export type PublishedDoctorUpsert = z.infer<typeof PublishedDoctorUpsertSchema>

export const PublishedProcedureUpsertSchema = z.object({
  doctorId: z.string().uuid(),
  procedureId: z.string().uuid(),
  displayName: z.string().min(3).max(100),
  durationMinutes: z.number().int().min(5).max(480),
  displayOrder: z.number().int().min(0).default(0),
})

export type PublishedProcedureUpsert = z.infer<typeof PublishedProcedureUpsertSchema>

// =========================================================================
// Read
// =========================================================================

export interface PublicBookingConfigFull {
  config: {
    publicBookingSlug: string | null
    publicBookingEnabled: boolean
    publicBookingMinHoursAdvance: number
    publicBookingMaxDaysAdvance: number
    publicBookingCancelMinHours: number
  }
  doctors: Array<{
    doctorId: string
    doctorFullName: string
    displayOrder: number
    bio: string | null
    availableWeekdays: number[]
    availableFrom: string
    availableUntil: string
    lunchBreakFrom: string | null
    lunchBreakUntil: string | null
  }>
  procedures: Array<{
    doctorId: string
    procedureId: string
    procedureName: string
    displayName: string
    durationMinutes: number
    displayOrder: number
  }>
}

/**
 * Lê a configuração completa de uma clínica para a tela admin.
 * Inclui: config base + médicos publicados (com nome do doctor via JOIN)
 * + procedimentos publicados (com nome do procedure via JOIN).
 */
export async function getPublicBookingConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PublicBookingConfigFull> {
  const [profileRes, doctorsRes, procsRes] = await Promise.all([
    supabase
      .from('tenant_clinic_profile')
      .select(
        'public_booking_slug, public_booking_enabled, public_booking_min_hours_advance, public_booking_max_days_advance, public_booking_cancel_min_hours',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('public_booking_doctors')
      .select(
        'doctor_id, display_order, bio, available_weekdays, available_from, available_until, lunch_break_from, lunch_break_until, doctors!inner(full_name)',
      )
      .eq('tenant_id', tenantId)
      .order('display_order'),
    supabase
      .from('public_booking_doctor_procedures')
      .select(
        'doctor_id, procedure_id, display_name, duration_minutes, display_order, procedures!inner(display_name, tuss_code)',
      )
      .eq('tenant_id', tenantId)
      .order('display_order'),
  ])

  if (profileRes.error) {
    throw new Error(`getPublicBookingConfig profile: ${profileRes.error.message}`)
  }
  if (doctorsRes.error) {
    throw new Error(`getPublicBookingConfig doctors: ${doctorsRes.error.message}`)
  }
  if (procsRes.error) {
    throw new Error(`getPublicBookingConfig procedures: ${procsRes.error.message}`)
  }

  const profile = profileRes.data
  return {
    config: {
      publicBookingSlug: profile?.public_booking_slug ?? null,
      publicBookingEnabled: profile?.public_booking_enabled ?? false,
      publicBookingMinHoursAdvance: profile?.public_booking_min_hours_advance ?? 24,
      publicBookingMaxDaysAdvance: profile?.public_booking_max_days_advance ?? 30,
      publicBookingCancelMinHours: profile?.public_booking_cancel_min_hours ?? 6,
    },
    doctors: (doctorsRes.data ?? []).map((row) => ({
      doctorId: row.doctor_id,
      // Supabase typegen retorna doctors como objeto via !inner; defensive cast.
      doctorFullName:
        (row.doctors as unknown as { full_name: string } | null)?.full_name ?? '—',
      displayOrder: row.display_order,
      bio: row.bio,
      availableWeekdays: row.available_weekdays,
      availableFrom: row.available_from,
      availableUntil: row.available_until,
      lunchBreakFrom: row.lunch_break_from,
      lunchBreakUntil: row.lunch_break_until,
    })),
    procedures: (procsRes.data ?? []).map((row) => {
      const proc = row.procedures as unknown as {
        display_name: string | null
        tuss_code: string | null
      } | null
      return {
        doctorId: row.doctor_id,
        procedureId: row.procedure_id,
        procedureName: proc?.display_name ?? proc?.tuss_code ?? '—',
        displayName: row.display_name,
        durationMinutes: row.duration_minutes,
        displayOrder: row.display_order,
      }
    }),
  }
}

// =========================================================================
// Mutations — todas exigem tenantId derivado da sessão (não do client)
// =========================================================================

/**
 * Atualiza as 5 colunas de configuração em `tenant_clinic_profile`.
 * Faz INSERT se não existir; UPDATE caso contrário (idempotente).
 *
 * Verifica unicidade do slug **explicitamente** antes do UPDATE para
 * dar erro amigável (DB UNIQUE índice já bloqueia mas com mensagem
 * técnica). Caller é responsável por garantir RBAC.
 */
export async function updatePublicBookingConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: PublicBookingConfigUpdate,
): Promise<void> {
  // Slug unique check (se preenchido)
  if (input.publicBookingSlug !== null) {
    const { data: conflict, error: conflictError } = await supabase
      .from('tenant_clinic_profile')
      .select('tenant_id')
      .eq('public_booking_slug', input.publicBookingSlug)
      .neq('tenant_id', tenantId)
      .maybeSingle()
    if (conflictError) {
      throw new Error(`updatePublicBookingConfig slug check: ${conflictError.message}`)
    }
    if (conflict) {
      throw new Error('SLUG_ALREADY_TAKEN')
    }
  }

  // Upsert real — cria a linha se ainda não existe (tenants novos que nunca
  // visitaram /configuracoes/clinica). Antes era .update() puro, que afetava
  // zero rows silenciosamente e o slug não era gravado.
  const { error } = await supabase.from('tenant_clinic_profile').upsert(
    {
      tenant_id: tenantId,
      public_booking_slug: input.publicBookingSlug,
      public_booking_enabled: input.publicBookingEnabled,
      public_booking_min_hours_advance: input.publicBookingMinHoursAdvance,
      public_booking_max_days_advance: input.publicBookingMaxDaysAdvance,
      public_booking_cancel_min_hours: input.publicBookingCancelMinHours,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) {
    throw new Error(`updatePublicBookingConfig: ${error.message}`)
  }
}

/** Publica/atualiza um médico no link público. */
export async function upsertPublishedDoctor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: PublishedDoctorUpsert,
): Promise<void> {
  const { error } = await supabase.from('public_booking_doctors').upsert(
    {
      tenant_id: tenantId,
      doctor_id: input.doctorId,
      display_order: input.displayOrder,
      bio: input.bio,
      available_weekdays: input.availableWeekdays,
      available_from: input.availableFrom,
      available_until: input.availableUntil,
      lunch_break_from: input.lunchBreakFrom,
      lunch_break_until: input.lunchBreakUntil,
    },
    { onConflict: 'tenant_id,doctor_id' },
  )
  if (error) {
    throw new Error(`upsertPublishedDoctor: ${error.message}`)
  }
}

/** Remove um médico do link público (CASCADE remove procedimentos vinculados). */
export async function removePublishedDoctor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  doctorId: string,
): Promise<void> {
  const { error } = await supabase
    .from('public_booking_doctors')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('doctor_id', doctorId)
  if (error) {
    throw new Error(`removePublishedDoctor: ${error.message}`)
  }
}

/** Publica/atualiza um procedimento para um médico publicado. */
export async function upsertPublishedProcedure(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: PublishedProcedureUpsert,
): Promise<void> {
  const { error } = await supabase
    .from('public_booking_doctor_procedures')
    .upsert(
      {
        tenant_id: tenantId,
        doctor_id: input.doctorId,
        procedure_id: input.procedureId,
        display_name: input.displayName,
        duration_minutes: input.durationMinutes,
        display_order: input.displayOrder,
      },
      { onConflict: 'tenant_id,doctor_id,procedure_id' },
    )
  if (error) {
    throw new Error(`upsertPublishedProcedure: ${error.message}`)
  }
}

/** Remove um procedimento publicado de um médico. */
export async function removePublishedProcedure(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  doctorId: string,
  procedureId: string,
): Promise<void> {
  const { error } = await supabase
    .from('public_booking_doctor_procedures')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('doctor_id', doctorId)
    .eq('procedure_id', procedureId)
  if (error) {
    throw new Error(`removePublishedProcedure: ${error.message}`)
  }
}

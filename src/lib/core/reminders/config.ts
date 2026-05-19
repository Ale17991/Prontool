/**
 * Feature 018 — CRUD de configuração do motor de lembretes.
 *
 * Server-side only. Lê/escreve as 8 colunas adicionadas em `tenant_clinic_profile`
 * pela migration 0094. Validação Zod inline.
 *
 * Constituição:
 * - II audit: cada UPDATE em tenant_clinic_profile gera audit_log via trigger existente.
 * - III multi-tenant: tenantId derivado da sessão, nunca do client.
 * - V RBAC: caller é responsável (server action chama requireRole antes).
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { ReminderConfig } from './types'

// =========================================================================
// Schema Zod
// =========================================================================

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, {
  message: 'Hora inválida. Use HH:MM (24h).',
})

export const ReminderConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    offsetsHours: z
      .array(z.number().int().min(0).max(168))
      .min(1)
      .max(5),
    sendWeekends: z.boolean(),
    windowStart: timeSchema,
    windowEnd: timeSchema,
    templateSubject: z.string().max(200).nullable(),
    templateBody: z.string().max(10000).nullable(),
  })
  .refine((v) => v.windowEnd > v.windowStart, {
    message: 'Janela inválida: fim deve ser maior que início.',
    path: ['windowEnd'],
  })
  .refine((v) => !v.enabled || v.offsetsHours.length >= 1, {
    message: 'Para habilitar, defina ao menos uma antecedência.',
    path: ['enabled'],
  })

export type ReminderConfigUpdate = z.infer<typeof ReminderConfigUpdateSchema>

// =========================================================================
// Read
// =========================================================================

/**
 * Lê a configuração de lembretes de um tenant. Retorna defaults consistentes
 * com a migration 0094 se a row de `tenant_clinic_profile` não existir
 * (cenário esperado para tenant que nunca abriu a tela).
 */
export async function getReminderConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<ReminderConfig> {
  const { data, error } = await supabase
    .from('tenant_clinic_profile')
    .select(
      'reminder_enabled, reminder_offsets_hours, reminder_send_weekends, reminder_window_start, reminder_window_end, reminder_template_subject, reminder_template_body, reminder_last_run_at',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    throw new Error(`getReminderConfig failed: ${error.message}`)
  }

  const row = data as {
    reminder_enabled: boolean | null
    reminder_offsets_hours: number[] | null
    reminder_send_weekends: boolean | null
    reminder_window_start: string | null
    reminder_window_end: string | null
    reminder_template_subject: string | null
    reminder_template_body: string | null
    reminder_last_run_at: string | null
  } | null

  return {
    enabled: row?.reminder_enabled ?? false,
    offsetsHours: row?.reminder_offsets_hours ?? [24],
    sendWeekends: row?.reminder_send_weekends ?? true,
    windowStart: trimSeconds(row?.reminder_window_start) ?? '08:00',
    windowEnd: trimSeconds(row?.reminder_window_end) ?? '20:00',
    templateSubject: row?.reminder_template_subject ?? null,
    templateBody: row?.reminder_template_body ?? null,
    lastRunAt: row?.reminder_last_run_at ?? null,
  }
}

function trimSeconds(t: string | null | undefined): string | null {
  if (!t) return null
  // Postgres TIME retorna 'HH:MM:SS'. Normalizamos para 'HH:MM'.
  return t.length >= 5 ? t.slice(0, 5) : t
}

// =========================================================================
// Update
// =========================================================================

/**
 * Atualiza as 8 colunas de configuração em `tenant_clinic_profile`.
 * O trigger de audit existente registra a alteração automaticamente.
 *
 * Caller é responsável pelo RBAC (server action chama requireRole antes).
 */
export async function updateReminderConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: ReminderConfigUpdate,
): Promise<void> {
  const { error } = await supabase
    .from('tenant_clinic_profile')
    .update({
      reminder_enabled: input.enabled,
      reminder_offsets_hours: input.offsetsHours,
      reminder_send_weekends: input.sendWeekends,
      reminder_window_start: input.windowStart,
      reminder_window_end: input.windowEnd,
      reminder_template_subject: input.templateSubject,
      reminder_template_body: input.templateBody,
    } as never)
    .eq('tenant_id', tenantId)
  if (error) {
    throw new Error(`updateReminderConfig failed: ${error.message}`)
  }
}

/**
 * Feature 018 — Opt-in/Opt-out de lembretes por paciente (US4).
 *
 * Apenas operações na coluna `patients.reminders_opt_in`. Audit já é
 * automático pelo trigger existente em `patients` (features 001/002).
 *
 * Constituição III: filtro EXPLÍCITO por tenant_id (defense in depth)
 * mesmo quando o client RLS já bloqueia cross-tenant.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export async function getPatientOptIn(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('patients')
    .select('reminders_opt_in')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    throw new Error(`getPatientOptIn failed: ${error.message}`)
  }
  // Default TRUE quando coluna ainda não migrada ou paciente sem flag definida
  const row = data as { reminders_opt_in: boolean | null } | null
  return row?.reminders_opt_in !== false
}

export async function setPatientOptIn(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
  optIn: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ reminders_opt_in: optIn } as never)
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
  if (error) {
    throw new Error(`setPatientOptIn failed: ${error.message}`)
  }
}

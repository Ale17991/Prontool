/**
 * Feature 017 — Lê médicos e procedimentos publicados para a página pública.
 *
 * Usa RLS de anon (policies definidas em 0093): apenas filas das tabelas
 * `public_booking_doctors` e `public_booking_doctor_procedures` cujo
 * tenant tem `public_booking_enabled = TRUE`. Sem PII.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { PublishedDoctor, PublishedProcedure } from './types'

export interface PublishedDoctorWithName extends PublishedDoctor {
  doctorFullName: string
}

export async function listPublishedDoctors(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PublishedDoctorWithName[]> {
  const { data, error } = await supabase
    .from('public_booking_doctors')
    .select(
      'tenant_id, doctor_id, display_order, bio, available_weekdays, available_from, available_until, lunch_break_from, lunch_break_until, doctors!inner(full_name)',
    )
    .eq('tenant_id', tenantId)
    .order('display_order')
  if (error) {
    throw new Error(`listPublishedDoctors failed: ${error.message}`)
  }
  return (data ?? []).map((row) => {
    const doctorJoin = (row.doctors as unknown as { full_name: string } | null) ?? null
    return {
      tenantId: row.tenant_id,
      doctorId: row.doctor_id,
      displayOrder: row.display_order,
      bio: row.bio,
      availableWeekdays: row.available_weekdays as PublishedDoctor['availableWeekdays'],
      availableFrom: row.available_from,
      availableUntil: row.available_until,
      lunchBreakFrom: row.lunch_break_from,
      lunchBreakUntil: row.lunch_break_until,
      doctorFullName: doctorJoin?.full_name ?? '—',
    }
  })
}

export async function listProceduresByDoctor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  doctorId: string,
): Promise<PublishedProcedure[]> {
  const { data, error } = await supabase
    .from('public_booking_doctor_procedures')
    .select(
      'tenant_id, doctor_id, procedure_id, display_name, duration_minutes, display_order',
    )
    .eq('tenant_id', tenantId)
    .eq('doctor_id', doctorId)
    .order('display_order')
  if (error) {
    throw new Error(`listProceduresByDoctor failed: ${error.message}`)
  }
  return (data ?? []).map((row) => ({
    tenantId: row.tenant_id,
    doctorId: row.doctor_id,
    procedureId: row.procedure_id,
    displayName: row.display_name,
    durationMinutes: row.duration_minutes,
    displayOrder: row.display_order,
  }))
}

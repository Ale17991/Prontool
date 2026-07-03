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
    .select('tenant_id, doctor_id, procedure_id, display_name, duration_minutes, display_order')
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

/**
 * Lista procedures unicos oferecidos por QUALQUER medico publicado do
 * tenant. Usado no modo "sem preferencia de profissional". Dedupe por
 * procedure_id: nome amigavel = primeiro encontrado; duracao = MAX para
 * garantir slot grande o suficiente independente do medico atribuido.
 */
export async function listProceduresAnyDoctor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PublishedProcedure[]> {
  const { data, error } = await supabase
    .from('public_booking_doctor_procedures')
    .select('tenant_id, doctor_id, procedure_id, display_name, duration_minutes, display_order')
    .eq('tenant_id', tenantId)
    .order('display_order')
  if (error) {
    throw new Error(`listProceduresAnyDoctor failed: ${error.message}`)
  }
  type Row = {
    tenant_id: string
    doctor_id: string
    procedure_id: string
    display_name: string
    duration_minutes: number
    display_order: number
  }
  const byProcedure = new Map<string, PublishedProcedure>()
  for (const row of (data ?? []) as Row[]) {
    const existing = byProcedure.get(row.procedure_id)
    if (!existing) {
      byProcedure.set(row.procedure_id, {
        tenantId: row.tenant_id,
        doctorId: row.doctor_id,
        procedureId: row.procedure_id,
        displayName: row.display_name,
        durationMinutes: row.duration_minutes,
        displayOrder: row.display_order,
      })
    } else if (row.duration_minutes > existing.durationMinutes) {
      // MAX duration para nao quebrar slot quando outro medico for atribuido
      byProcedure.set(row.procedure_id, {
        ...existing,
        durationMinutes: row.duration_minutes,
      })
    }
  }
  return Array.from(byProcedure.values()).sort((a, b) => a.displayOrder - b.displayOrder)
}

/**
 * Lista doctor_ids que oferecem o procedimento informado. Usado pelo modo
 * "sem preferencia" para construir o pool de candidatos.
 */
export async function listDoctorsForProcedure(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  procedureId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('public_booking_doctor_procedures')
    .select('doctor_id')
    .eq('tenant_id', tenantId)
    .eq('procedure_id', procedureId)
  if (error) {
    throw new Error(`listDoctorsForProcedure failed: ${error.message}`)
  }
  return Array.from(new Set((data ?? []).map((r) => r.doctor_id as string)))
}

/**
 * Feature 017 — Lista slots disponíveis para uma combinação slug+médico+procedimento.
 *
 * Wrapper sobre RPC `public_booking_slots` (SECURITY DEFINER). A RPC já
 * filtra implicitamente por slug habilitado, médico publicado e
 * procedimento publicado para o médico. Retorna 0 linhas se qualquer
 * filtro falhar — não joga.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { SlotDTO } from './types'

export interface ListSlotsInput {
  slug: string
  doctorId: string
  procedureId: string
  /** Data inicial (YYYY-MM-DD). */
  from: string
  /** Data final inclusive (YYYY-MM-DD). */
  to: string
}

export async function listPublicBookingSlots(
  supabase: SupabaseClient<Database>,
  input: ListSlotsInput,
): Promise<SlotDTO[]> {
  const { data, error } = await supabase.rpc(
    'public_booking_slots' as never,
    {
      p_slug: input.slug,
      p_doctor_id: input.doctorId,
      p_procedure_id: input.procedureId,
      p_from: input.from,
      p_to: input.to,
    } as never,
  )
  if (error) {
    throw new Error(`listPublicBookingSlots failed: ${error.message}`)
  }
  const rows = (data as unknown as Array<{
    slot_start: string
    slot_end: string
  }> | null) ?? []
  return rows.map((r) => ({ start: r.slot_start, end: r.slot_end }))
}

export interface ListAnyDoctorSlotsInput {
  slug: string
  doctorIds: string[]
  procedureId: string
  from: string
  to: string
}

/**
 * Modo "sem preferencia": chama public_booking_slots em paralelo para cada
 * medico candidato e une os resultados, deduplicando por slot_start. Se
 * dois medicos tem o mesmo slot livre, conta uma vez — paciente nao se
 * preocupa com qual sera atribuido.
 */
export async function listAnyDoctorSlots(
  supabase: SupabaseClient<Database>,
  input: ListAnyDoctorSlotsInput,
): Promise<SlotDTO[]> {
  if (input.doctorIds.length === 0) return []
  const settled = await Promise.allSettled(
    input.doctorIds.map((doctorId) =>
      listPublicBookingSlots(supabase, {
        slug: input.slug,
        doctorId,
        procedureId: input.procedureId,
        from: input.from,
        to: input.to,
      }),
    ),
  )
  const seen = new Set<string>()
  const merged: SlotDTO[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const slot of r.value) {
      if (seen.has(slot.start)) continue
      seen.add(slot.start)
      merged.push(slot)
    }
  }
  merged.sort((a, b) => a.start.localeCompare(b.start))
  return merged
}

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

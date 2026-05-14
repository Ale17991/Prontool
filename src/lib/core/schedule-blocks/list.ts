import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { ScheduleBlockRow } from './types'

interface ListInput {
  tenantId: string
  /** YYYY-MM-DD; inclusivo */
  from?: string
  /** YYYY-MM-DD; inclusivo */
  to?: string
  doctorId?: string
}

/**
 * Lista bloqueios ATIVOS (deleted_at IS NULL) de um tenant no intervalo.
 * Inclui doctor_name via embed para a UI nao precisar buscar separadamente.
 */
export async function listScheduleBlocks(
  supabase: SupabaseClient<Database>,
  input: ListInput,
): Promise<ScheduleBlockRow[]> {
  let q = supabase
    .from('schedule_blocks' as never)
    .select(
      'id, tenant_id, doctor_id, block_date, start_time, end_time, all_day, reason, ' +
        'created_by, created_at, deleted_at, deleted_by, ' +
        'doctors:doctor_id(full_name)',
    )
    .eq('tenant_id', input.tenantId)
    .is('deleted_at', null)
    .order('block_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })

  if (input.from) q = q.gte('block_date', input.from)
  if (input.to) q = q.lte('block_date', input.to)
  if (input.doctorId) q = q.eq('doctor_id', input.doctorId)

  const res = await q
  if (res.error) {
    if (/relation .*schedule_blocks.* does not exist/i.test(res.error.message)) {
      // Migration 0083 nao aplicada — degrade gracioso.
      return []
    }
    throw new Error(`listScheduleBlocks failed: ${res.error.message}`)
  }

  type Raw = {
    id: string
    tenant_id: string
    doctor_id: string
    block_date: string
    start_time: string | null
    end_time: string | null
    all_day: boolean
    reason: string
    created_by: string
    created_at: string
    deleted_at: string | null
    deleted_by: string | null
    doctors: { full_name: string | null } | null
  }
  return (res.data as unknown as Raw[]).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    doctorId: r.doctor_id,
    doctorName: r.doctors?.full_name ?? null,
    blockDate: r.block_date,
    startTime: r.start_time ? r.start_time.slice(0, 5) : null,
    endTime: r.end_time ? r.end_time.slice(0, 5) : null,
    allDay: r.all_day,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
  }))
}

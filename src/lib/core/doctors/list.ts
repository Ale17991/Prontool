import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * T124 — Lista médicos do tenant com a comissão vigente resolvida do
 * `doctor_commission_current` view (head por médico, `valid_from <=
 * CURRENT_DATE`). Se um médico não tem comissão vigente hoje (ex:
 * recém-criado com vigência futura), `currentPercentageBps` = null.
 */
export interface ListedDoctor {
  id: string
  fullName: string
  crm: string
  externalIdentifier: string | null
  active: boolean
  createdAt: string
  currentPercentageBps: number | null
  currentValidFrom: string | null
}

interface DoctorRow {
  id: string
  full_name: string
  crm: string
  external_identifier: string | null
  active: boolean
  created_at: string
}

interface CommissionHead {
  doctor_id: string
  percentage_bps: number
  valid_from: string
}

export async function listDoctors(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<ListedDoctor[]> {
  let q = supabase
    .from('doctors')
    .select('id, full_name, crm, external_identifier, active, created_at')
    .eq('tenant_id', args.tenantId)
    .order('full_name', { ascending: true })
  if (!args.includeInactive) q = q.eq('active', true)

  const { data: rawDoctors, error } = await q
  if (error) throw new Error(`listDoctors failed: ${error.message}`)
  const doctors = (rawDoctors ?? []) as DoctorRow[]
  if (doctors.length === 0) return []

  const { data: rawHeads, error: headsErr } = await supabase
    .from('doctor_commission_current')
    .select('doctor_id, percentage_bps, valid_from')
    .eq('tenant_id', args.tenantId)
    .in(
      'doctor_id',
      doctors.map((d) => d.id),
    )
  if (headsErr) throw new Error(`commission heads query failed: ${headsErr.message}`)
  const heads = new Map<string, CommissionHead>()
  for (const h of (rawHeads ?? []) as CommissionHead[]) heads.set(h.doctor_id, h)

  return doctors.map((d) => {
    const h = heads.get(d.id)
    return {
      id: d.id,
      fullName: d.full_name,
      crm: d.crm,
      externalIdentifier: d.external_identifier,
      active: d.active,
      createdAt: d.created_at,
      currentPercentageBps: h?.percentage_bps ?? null,
      currentValidFrom: h?.valid_from ?? null,
    }
  })
}

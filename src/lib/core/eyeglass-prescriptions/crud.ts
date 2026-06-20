import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface EyeData {
  sphere: string | null
  cylinder: string | null
  axis: string | null
  addition: string | null
  prism: string | null
  base: string | null
  dnp: string | null
}

export interface EyeglassRx {
  id: string
  od: EyeData
  oe: EyeData
  readingDistance: string | null
  notes: string | null
  issuedAt: string | null
  createdAt: string
}

export interface CreateEyeglassRxInput {
  tenantId: string
  patientId: string
  actorUserId: string
  doctorId?: string | null
  od: EyeData
  oe: EyeData
  readingDistance?: string | null
  notes?: string | null
}

const COLS =
  'id, od_sphere, od_cylinder, od_axis, od_addition, od_prism, od_base, od_dnp, ' +
  'oe_sphere, oe_cylinder, oe_axis, oe_addition, oe_prism, oe_base, oe_dnp, ' +
  'reading_distance, notes, issued_at, created_at'

const t = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

function toDto(r: Record<string, unknown>): EyeglassRx {
  const g = (k: string) => (r[k] as string | null) ?? null
  return {
    id: r.id as string,
    od: {
      sphere: g('od_sphere'), cylinder: g('od_cylinder'), axis: g('od_axis'),
      addition: g('od_addition'), prism: g('od_prism'), base: g('od_base'), dnp: g('od_dnp'),
    },
    oe: {
      sphere: g('oe_sphere'), cylinder: g('oe_cylinder'), axis: g('oe_axis'),
      addition: g('oe_addition'), prism: g('oe_prism'), base: g('oe_base'), dnp: g('oe_dnp'),
    },
    readingDistance: g('reading_distance'),
    notes: g('notes'),
    issuedAt: g('issued_at'),
    createdAt: r.created_at as string,
  }
}

export async function createEyeglassRx(
  supabase: SupabaseClient<Database>,
  input: CreateEyeglassRxInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('eyeglass_prescriptions' as never)
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      doctor_id: input.doctorId ?? null,
      od_sphere: t(input.od.sphere), od_cylinder: t(input.od.cylinder), od_axis: t(input.od.axis),
      od_addition: t(input.od.addition), od_prism: t(input.od.prism), od_base: t(input.od.base), od_dnp: t(input.od.dnp),
      oe_sphere: t(input.oe.sphere), oe_cylinder: t(input.oe.cylinder), oe_axis: t(input.oe.axis),
      oe_addition: t(input.oe.addition), oe_prism: t(input.oe.prism), oe_base: t(input.oe.base), oe_dnp: t(input.oe.dnp),
      reading_distance: t(input.readingDistance),
      notes: t(input.notes),
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`createEyeglassRx failed: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function listEyeglassRx(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<EyeglassRx[]> {
  const { data, error } = await supabase
    .from('eyeglass_prescriptions' as never)
    .select(COLS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listEyeglassRx failed: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toDto)
}

export async function getEyeglassRx(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string },
): Promise<EyeglassRx | null> {
  const { data, error } = await supabase
    .from('eyeglass_prescriptions' as never)
    .select(COLS)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`getEyeglassRx failed: ${error.message}`)
  return data ? toDto(data as unknown as Record<string, unknown>) : null
}

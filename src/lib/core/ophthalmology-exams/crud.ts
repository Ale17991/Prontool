import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface RefrEye { sphere: string | null; cylinder: string | null; axis: string | null }

export interface OphthalExam {
  id: string
  examDate: string
  av: { odSc: string | null; odCc: string | null; oeSc: string | null; oeCc: string | null }
  refr: { od: RefrEye; oe: RefrEye }
  pio: { od: string | null; oe: string | null }
  biomicroscopy: string | null
  fundoscopy: string | null
  notes: string | null
  issuedAt: string | null
  createdAt: string
}

export interface CreateOphthalExamInput {
  tenantId: string
  patientId: string
  actorUserId: string
  doctorId?: string | null
  av: { odSc?: string | null; odCc?: string | null; oeSc?: string | null; oeCc?: string | null }
  refr: { od: Partial<RefrEye>; oe: Partial<RefrEye> }
  pio: { od?: string | null; oe?: string | null }
  biomicroscopy?: string | null
  fundoscopy?: string | null
  notes?: string | null
}

const COLS =
  'id, exam_date, av_od_sc, av_od_cc, av_oe_sc, av_oe_cc, ' +
  'refr_od_sphere, refr_od_cylinder, refr_od_axis, refr_oe_sphere, refr_oe_cylinder, refr_oe_axis, ' +
  'pio_od, pio_oe, biomicroscopy, fundoscopy, notes, issued_at, created_at'

const t = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

function toDto(r: Record<string, unknown>): OphthalExam {
  const g = (k: string) => (r[k] as string | null) ?? null
  return {
    id: r.id as string,
    examDate: r.exam_date as string,
    av: { odSc: g('av_od_sc'), odCc: g('av_od_cc'), oeSc: g('av_oe_sc'), oeCc: g('av_oe_cc') },
    refr: {
      od: { sphere: g('refr_od_sphere'), cylinder: g('refr_od_cylinder'), axis: g('refr_od_axis') },
      oe: { sphere: g('refr_oe_sphere'), cylinder: g('refr_oe_cylinder'), axis: g('refr_oe_axis') },
    },
    pio: { od: g('pio_od'), oe: g('pio_oe') },
    biomicroscopy: g('biomicroscopy'),
    fundoscopy: g('fundoscopy'),
    notes: g('notes'),
    issuedAt: g('issued_at'),
    createdAt: r.created_at as string,
  }
}

export async function createOphthalExam(
  supabase: SupabaseClient<Database>,
  input: CreateOphthalExamInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('ophthalmology_exams' as never)
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      doctor_id: input.doctorId ?? null,
      av_od_sc: t(input.av.odSc), av_od_cc: t(input.av.odCc), av_oe_sc: t(input.av.oeSc), av_oe_cc: t(input.av.oeCc),
      refr_od_sphere: t(input.refr.od.sphere), refr_od_cylinder: t(input.refr.od.cylinder), refr_od_axis: t(input.refr.od.axis),
      refr_oe_sphere: t(input.refr.oe.sphere), refr_oe_cylinder: t(input.refr.oe.cylinder), refr_oe_axis: t(input.refr.oe.axis),
      pio_od: t(input.pio.od), pio_oe: t(input.pio.oe),
      biomicroscopy: t(input.biomicroscopy), fundoscopy: t(input.fundoscopy), notes: t(input.notes),
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`createOphthalExam failed: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function listOphthalExams(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<OphthalExam[]> {
  const { data, error } = await supabase
    .from('ophthalmology_exams' as never)
    .select(COLS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .is('deleted_at', null)
    .order('exam_date', { ascending: false })
  if (error) throw new Error(`listOphthalExams failed: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toDto)
}

export async function getOphthalExam(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string },
): Promise<OphthalExam | null> {
  const { data, error } = await supabase
    .from('ophthalmology_exams' as never)
    .select(COLS)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`getOphthalExam failed: ${error.message}`)
  return data ? toDto(data as unknown as Record<string, unknown>) : null
}

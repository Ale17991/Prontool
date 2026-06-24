import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import { calcCal, type PerioSite } from './sites'

export interface PerioIndicatorsDTO {
  sitesMeasured: number
  sitesBleeding: number
  bopPct: number
  pocketsGe4: number
  pocketsGe4Pct: number
  calAvgMm: number | null
}

export interface PerioMeasurementDTO {
  toothFdi: number
  site: PerioSite
  probingDepthMm: number | null
  recessionMm: number | null
  calMm: number | null
  bleeding: boolean
  suppuration: boolean
  plaque: boolean
}

export interface PerioFindingDTO {
  toothFdi: number
  mobility: number | null
  furcation: number | null
  isMissing: boolean
  isImplant: boolean
}

export interface PerioExamDTO {
  id: string
  examDate: string
  status: 'rascunho' | 'finalizado'
  dentition: 'permanent' | 'deciduous'
  notes: string | null
  appointmentId: string | null
  finalizedAt: string | null
}

export interface PerioExamView {
  exam: PerioExamDTO
  measurements: PerioMeasurementDTO[]
  findings: PerioFindingDTO[]
  indicators: PerioIndicatorsDTO
}

const ZERO_INDICATORS: PerioIndicatorsDTO = {
  sitesMeasured: 0,
  sitesBleeding: 0,
  bopPct: 0,
  pocketsGe4: 0,
  pocketsGe4Pct: 0,
  calAvgMm: null,
}

export async function perioIndicators(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  examId: string,
): Promise<PerioIndicatorsDTO> {
  const res = await supabase.rpc('perio_exam_indicators', {
    p_tenant_id: tenantId,
    p_exam_id: examId,
  })
  if (res.error) throw new Error(`perio_exam_indicators: ${res.error.message}`)
  const row = (res.data ?? [])[0]
  if (!row) return ZERO_INDICATORS
  return {
    sitesMeasured: row.sites_measured ?? 0,
    sitesBleeding: row.sites_bleeding ?? 0,
    bopPct: Number(row.bop_pct ?? 0),
    pocketsGe4: row.pockets_ge4 ?? 0,
    pocketsGe4Pct: Number(row.pockets_ge4_pct ?? 0),
    calAvgMm: row.cal_avg_mm === null || row.cal_avg_mm === undefined ? null : Number(row.cal_avg_mm),
  }
}

/** Exame completo: header + medições + achados + indicadores. */
export async function getPerioExam(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; examId: string },
): Promise<PerioExamView> {
  const examRes = await supabase
    .from('perio_exams')
    .select('id, exam_date, status, dentition, notes, appointment_id, finalized_at')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.examId)
    .maybeSingle()
  if (examRes.error) throw new Error(`getPerioExam: ${examRes.error.message}`)
  if (!examRes.data) throw new NotFoundError('perio_exam', input.examId)
  const e = examRes.data

  const [measRes, findRes, indicators] = await Promise.all([
    supabase
      .from('perio_site_measurements')
      .select('tooth_fdi, site, probing_depth_mm, recession_mm, bleeding, suppuration, plaque')
      .eq('tenant_id', input.tenantId)
      .eq('exam_id', input.examId),
    supabase
      .from('perio_tooth_findings')
      .select('tooth_fdi, mobility, furcation, is_missing, is_implant')
      .eq('tenant_id', input.tenantId)
      .eq('exam_id', input.examId),
    perioIndicators(supabase, input.tenantId, input.examId),
  ])
  if (measRes.error) throw new Error(`getPerioExam measurements: ${measRes.error.message}`)
  if (findRes.error) throw new Error(`getPerioExam findings: ${findRes.error.message}`)

  const measurements: PerioMeasurementDTO[] = (measRes.data ?? []).map((m) => ({
    toothFdi: m.tooth_fdi,
    site: m.site as PerioSite,
    probingDepthMm: m.probing_depth_mm,
    recessionMm: m.recession_mm,
    calMm: calcCal(m.probing_depth_mm, m.recession_mm),
    bleeding: m.bleeding,
    suppuration: m.suppuration,
    plaque: m.plaque,
  }))

  const findings: PerioFindingDTO[] = (findRes.data ?? []).map((f) => ({
    toothFdi: f.tooth_fdi,
    mobility: f.mobility,
    furcation: f.furcation,
    isMissing: f.is_missing,
    isImplant: f.is_implant,
  }))

  return {
    exam: {
      id: e.id,
      examDate: e.exam_date,
      status: e.status as 'rascunho' | 'finalizado',
      dentition: e.dentition as 'permanent' | 'deciduous',
      notes: e.notes,
      appointmentId: e.appointment_id,
      finalizedAt: e.finalized_at,
    },
    measurements,
    findings,
    indicators,
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { perioIndicators, type PerioIndicatorsDTO } from './get-exam'
import type { PerioSite } from './sites'

export interface PerioCompareSite {
  toothFdi: number
  site: PerioSite
  fromPd: number | null
  toPd: number | null
  deltaPd: number | null
  fromBleeding: boolean
  toBleeding: boolean
}

export interface PerioCompareExamRef {
  id: string
  examDate: string
  indicators: PerioIndicatorsDTO
}

export interface PerioCompareView {
  from: PerioCompareExamRef
  to: PerioCompareExamRef
  sites: PerioCompareSite[]
  deltas: { bopPct: number; pocketsGe4: number; calAvgMm: number | null }
}

interface ExamRow {
  id: string
  exam_date: string
  status: string
}
interface MeasRow {
  tooth_fdi: number
  site: string
  probing_depth_mm: number | null
  bleeding: boolean
}

function posKey(toothFdi: number, site: string): string {
  return `${toothFdi}:${site}`
}

/**
 * Compara dois exames finalizados do mesmo paciente: variação de profundidade
 * de sondagem e sangramento por sítio + deltas dos indicadores agregados.
 */
export async function comparePerioExams(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; patientId: string; fromExamId: string; toExamId: string },
): Promise<PerioCompareView> {
  if (input.fromExamId === input.toExamId) {
    throw new ValidationError('Selecione dois exames diferentes para comparar.')
  }

  const examsRes = await supabase
    .from('perio_exams')
    .select('id, exam_date, status')
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .in('id', [input.fromExamId, input.toExamId])
  if (examsRes.error) throw new Error(`comparePerioExams exams: ${examsRes.error.message}`)
  const rows = (examsRes.data ?? []) as ExamRow[]
  const fromExam = rows.find((r) => r.id === input.fromExamId)
  const toExam = rows.find((r) => r.id === input.toExamId)
  if (!fromExam || !toExam) throw new NotFoundError('perio_exam')
  if (fromExam.status !== 'finalizado' || toExam.status !== 'finalizado') {
    throw new ValidationError('Só é possível comparar exames finalizados.')
  }

  const [fromMeas, toMeas, fromInd, toInd] = await Promise.all([
    supabase
      .from('perio_site_measurements')
      .select('tooth_fdi, site, probing_depth_mm, bleeding')
      .eq('tenant_id', input.tenantId)
      .eq('exam_id', input.fromExamId),
    supabase
      .from('perio_site_measurements')
      .select('tooth_fdi, site, probing_depth_mm, bleeding')
      .eq('tenant_id', input.tenantId)
      .eq('exam_id', input.toExamId),
    perioIndicators(supabase, input.tenantId, input.fromExamId),
    perioIndicators(supabase, input.tenantId, input.toExamId),
  ])
  if (fromMeas.error) throw new Error(`comparePerioExams from: ${fromMeas.error.message}`)
  if (toMeas.error) throw new Error(`comparePerioExams to: ${toMeas.error.message}`)

  const fromMap = new Map<string, MeasRow>()
  for (const m of (fromMeas.data ?? []) as MeasRow[]) fromMap.set(posKey(m.tooth_fdi, m.site), m)
  const toMap = new Map<string, MeasRow>()
  for (const m of (toMeas.data ?? []) as MeasRow[]) toMap.set(posKey(m.tooth_fdi, m.site), m)

  const keys = new Set<string>([...fromMap.keys(), ...toMap.keys()])
  const sites: PerioCompareSite[] = [...keys]
    .map((k) => {
      const f = fromMap.get(k)
      const t = toMap.get(k)
      const [toothFdi, site] = k.split(':')
      const fromPd = f?.probing_depth_mm ?? null
      const toPd = t?.probing_depth_mm ?? null
      return {
        toothFdi: Number(toothFdi),
        site: site as PerioSite,
        fromPd,
        toPd,
        deltaPd: fromPd !== null && toPd !== null ? toPd - fromPd : null,
        fromBleeding: f?.bleeding ?? false,
        toBleeding: t?.bleeding ?? false,
      }
    })
    .sort((a, b) => a.toothFdi - b.toothFdi || a.site.localeCompare(b.site))

  return {
    from: { id: fromExam.id, examDate: fromExam.exam_date, indicators: fromInd },
    to: { id: toExam.id, examDate: toExam.exam_date, indicators: toInd },
    sites,
    deltas: {
      bopPct: Math.round((toInd.bopPct - fromInd.bopPct) * 10) / 10,
      pocketsGe4: toInd.pocketsGe4 - fromInd.pocketsGe4,
      calAvgMm:
        fromInd.calAvgMm !== null && toInd.calAvgMm !== null
          ? Math.round((toInd.calAvgMm - fromInd.calAvgMm) * 10) / 10
          : null,
    },
  }
}

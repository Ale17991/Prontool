import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { isValidTooth } from '@/lib/core/dental/teeth'
import {
  isValidPerioSite,
  isValidProbingDepth,
  isValidRecession,
  type PerioSite,
} from './sites'

export interface SaveMeasurementInput {
  toothFdi: number
  site: PerioSite
  probingDepthMm?: number | null
  recessionMm?: number | null
  bleeding?: boolean
  suppuration?: boolean
  plaque?: boolean
}

export interface SaveFindingInput {
  toothFdi: number
  mobility?: number | null
  furcation?: number | null
  isMissing?: boolean
  isImplant?: boolean
}

export interface SavePerioInput {
  tenantId: string
  examId: string
  measurements?: SaveMeasurementInput[]
  findings?: SaveFindingInput[]
  notes?: string | null
}

/**
 * Salva em lote (upsert) medições por sítio e achados por dente de um exame em
 * rascunho. Valida posição/faixas; o trigger de banco rejeita escrita se o
 * exame não estiver em rascunho (erro mapeado para `EXAM_FINALIZED`).
 */
export async function savePerioMeasurements(
  supabase: SupabaseClient<Database>,
  input: SavePerioInput,
): Promise<void> {
  // Confirma exame do tenant + estado de rascunho (defesa antes dos triggers).
  const exam = await supabase
    .from('perio_exams')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.examId)
    .maybeSingle()
  if (exam.error) throw new Error(`exam lookup: ${exam.error.message}`)
  if (!exam.data) throw new NotFoundError('perio_exam', input.examId)
  if (exam.data.status !== 'rascunho') {
    throw new ConflictError('EXAM_FINALIZED', 'Exame finalizado é imutável.')
  }

  const measurements = input.measurements ?? []
  const findings = input.findings ?? []

  for (const m of measurements) {
    if (!isValidTooth(m.toothFdi)) throw new ValidationError('Dente FDI inválido', { toothFdi: m.toothFdi })
    if (!isValidPerioSite(m.site)) throw new ValidationError('Sítio inválido', { site: m.site })
    if (typeof m.probingDepthMm === 'number' && !isValidProbingDepth(m.probingDepthMm)) {
      throw new ValidationError('Profundidade de sondagem fora da faixa (0–15 mm).', { value: m.probingDepthMm })
    }
    if (typeof m.recessionMm === 'number' && !isValidRecession(m.recessionMm)) {
      throw new ValidationError('Recessão fora da faixa (−5 a +15 mm).', { value: m.recessionMm })
    }
  }
  for (const f of findings) {
    if (!isValidTooth(f.toothFdi)) throw new ValidationError('Dente FDI inválido', { toothFdi: f.toothFdi })
    if (typeof f.mobility === 'number' && (f.mobility < 0 || f.mobility > 3)) {
      throw new ValidationError('Mobilidade fora da faixa (0–3).', { value: f.mobility })
    }
    if (typeof f.furcation === 'number' && (f.furcation < 1 || f.furcation > 3)) {
      throw new ValidationError('Furca fora da faixa (I–III).', { value: f.furcation })
    }
  }

  const mapConflict = (msg: string | undefined, code?: string) => {
    if (code === '42501') return new ConflictError('EXAM_FINALIZED', 'Exame finalizado é imutável.')
    return new Error(msg ?? 'perio save failed')
  }

  if (measurements.length > 0) {
    const rows = measurements.map((m) => ({
      tenant_id: input.tenantId,
      exam_id: input.examId,
      tooth_fdi: m.toothFdi,
      site: m.site,
      probing_depth_mm: m.probingDepthMm ?? null,
      recession_mm: m.recessionMm ?? null,
      bleeding: m.bleeding ?? false,
      suppuration: m.suppuration ?? false,
      plaque: m.plaque ?? false,
    }))
    const res = await supabase
      .from('perio_site_measurements')
      .upsert(rows, { onConflict: 'exam_id,tooth_fdi,site' })
    if (res.error) throw mapConflict(res.error.message, res.error.code)
  }

  if (findings.length > 0) {
    const rows = findings.map((f) => ({
      tenant_id: input.tenantId,
      exam_id: input.examId,
      tooth_fdi: f.toothFdi,
      mobility: f.mobility ?? null,
      furcation: f.furcation ?? null,
      is_missing: f.isMissing ?? false,
      is_implant: f.isImplant ?? false,
    }))
    const res = await supabase
      .from('perio_tooth_findings')
      .upsert(rows, { onConflict: 'exam_id,tooth_fdi' })
    if (res.error) throw mapConflict(res.error.message, res.error.code)
  }

  if (input.notes !== undefined) {
    const res = await supabase
      .from('perio_exams')
      .update({ notes: input.notes?.trim() || null })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.examId)
    if (res.error) throw mapConflict(res.error.message, res.error.code)
  }
}

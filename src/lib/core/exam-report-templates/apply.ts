import type { OphthalExam } from '@/lib/core/ophthalmology-exams/crud'
import type { ExamReportTemplate } from './crud'
import { substitutePlaceholders } from './placeholders'

export interface ResolvedExamReport {
  headerText: string | null
  conclusionText: string | null
  footerText: string | null
}

function ageFromBirth(birth: string | null): string {
  if (!birth) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth)
  if (!m) return ''
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(b.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const md = now.getMonth() - b.getMonth()
  if (md < 0 || (md === 0 && now.getDate() < b.getDate())) age--
  return age >= 0 ? String(age) : ''
}

function ddmmyyyy(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function refr(eye: {
  sphere: string | null
  cylinder: string | null
  axis: string | null
}): string {
  const parts = [eye.sphere, eye.cylinder, eye.axis].map((v) => (v && v.trim() ? v.trim() : '—'))
  return parts.join(' / ')
}

/**
 * Backlog 2/2 — resolve um modelo de laudo oftalmológico para um exame concreto:
 * substitui os placeholders pelos valores do exame e do paciente. Devolve os três
 * blocos prontos para o PDF.
 */
export function resolveOphthalReportTemplate(
  template: ExamReportTemplate,
  ctx: { exam: OphthalExam; patientName: string; birthDate: string | null; clinicName: string },
): ResolvedExamReport {
  const ex = ctx.exam
  const vars: Record<string, string> = {
    'paciente.nome': ctx.patientName || '',
    'paciente.idade': ageFromBirth(ctx.birthDate),
    'exame.data': ddmmyyyy(ex.examDate),
    'exame.av_od_sc': ex.av.odSc ?? '',
    'exame.av_od_cc': ex.av.odCc ?? '',
    'exame.av_oe_sc': ex.av.oeSc ?? '',
    'exame.av_oe_cc': ex.av.oeCc ?? '',
    'exame.refr_od': refr(ex.refr.od),
    'exame.refr_oe': refr(ex.refr.oe),
    'exame.pio_od': ex.pio.od ?? '',
    'exame.pio_oe': ex.pio.oe ?? '',
    'clinica.nome': ctx.clinicName || '',
    data: new Date().toLocaleDateString('pt-BR'),
  }
  const sub = (t: string | null): string | null => (t ? substitutePlaceholders(t, vars) : null)
  return {
    headerText: sub(template.headerText),
    conclusionText: sub(template.conclusionText),
    footerText: sub(template.footerText),
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

export type ExamType = 'oftalmologico'

export interface ExamReportTemplate {
  id: string
  examType: ExamType
  name: string
  headerText: string | null
  conclusionText: string | null
  footerText: string | null
  isDefault: boolean
}

interface Row {
  id: string
  exam_type: ExamType
  name: string
  header_text: string | null
  conclusion_text: string | null
  footer_text: string | null
  is_default: boolean
}

const SELECT = 'id, exam_type, name, header_text, conclusion_text, footer_text, is_default'

function toDto(r: Row): ExamReportTemplate {
  return {
    id: r.id,
    examType: r.exam_type,
    name: r.name,
    headerText: r.header_text,
    conclusionText: r.conclusion_text,
    footerText: r.footer_text,
    isDefault: r.is_default,
  }
}

export async function listExamReportTemplates(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; examType?: ExamType },
): Promise<ExamReportTemplate[]> {
  let query = supabase
    .from('exam_report_templates' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (args.examType) query = query.eq('exam_type', args.examType)
  const { data, error } = await query
  if (error) throw new Error(`listExamReportTemplates failed: ${error.message}`)
  return ((data ?? []) as unknown as Row[]).map(toDto)
}

export async function getDefaultExamReportTemplate(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; examType: ExamType },
): Promise<ExamReportTemplate | null> {
  const { data, error } = await supabase
    .from('exam_report_templates' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('exam_type', args.examType)
    .eq('is_default', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`getDefaultExamReportTemplate failed: ${error.message}`)
  return data ? toDto(data as unknown as Row) : null
}

export interface UpsertExamReportTemplateInput {
  tenantId: string
  actorUserId: string
  examType: ExamType
  name: string
  headerText?: string | null
  conclusionText?: string | null
  footerText?: string | null
  isDefault: boolean
}

function validate(input: UpsertExamReportTemplateInput) {
  if (input.name.trim().length < 1) throw new ValidationError('Nome do modelo é obrigatório.')
  if (input.name.trim().length > 120) throw new ValidationError('Nome muito longo.')
}

/** Garante no máximo um default por (tenant, tipo): rebaixa os demais. */
async function clearOtherDefaults(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; examType: ExamType; exceptId?: string },
): Promise<void> {
  let query = supabase
    .from('exam_report_templates' as never)
    .update({ is_default: false } as never)
    .eq('tenant_id', args.tenantId)
    .eq('exam_type', args.examType)
    .eq('is_default', true)
    .is('deleted_at', null)
  if (args.exceptId) query = query.neq('id', args.exceptId)
  const { error } = await query
  if (error) throw new Error(`clearOtherDefaults failed: ${error.message}`)
}

export async function createExamReportTemplate(
  supabase: SupabaseClient<Database>,
  input: UpsertExamReportTemplateInput,
): Promise<{ id: string }> {
  validate(input)
  if (input.isDefault) {
    await clearOtherDefaults(supabase, { tenantId: input.tenantId, examType: input.examType })
  }
  const { data, error } = await supabase
    .from('exam_report_templates' as never)
    .insert({
      tenant_id: input.tenantId,
      exam_type: input.examType,
      name: input.name.trim(),
      header_text: input.headerText?.trim() || null,
      conclusion_text: input.conclusionText?.trim() || null,
      footer_text: input.footerText?.trim() || null,
      is_default: input.isDefault,
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`createExamReportTemplate failed: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function updateExamReportTemplate(
  supabase: SupabaseClient<Database>,
  id: string,
  input: UpsertExamReportTemplateInput,
): Promise<void> {
  validate(input)
  if (input.isDefault) {
    await clearOtherDefaults(supabase, {
      tenantId: input.tenantId,
      examType: input.examType,
      exceptId: id,
    })
  }
  const { data, error } = await supabase
    .from('exam_report_templates' as never)
    .update({
      exam_type: input.examType,
      name: input.name.trim(),
      header_text: input.headerText?.trim() || null,
      conclusion_text: input.conclusionText?.trim() || null,
      footer_text: input.footerText?.trim() || null,
      is_default: input.isDefault,
      updated_at: new Date().toISOString(),
      updated_by: input.actorUserId,
    } as never)
    .eq('tenant_id', input.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`updateExamReportTemplate failed: ${error.message}`)
  if (!data) throw new NotFoundError('exam_report_template', id)
}

export async function softDeleteExamReportTemplate(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string; actorUserId: string },
): Promise<void> {
  const { error } = await supabase
    .from('exam_report_templates' as never)
    .update({ deleted_at: new Date().toISOString(), deleted_by: args.actorUserId } as never)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
  if (error) throw new Error(`softDeleteExamReportTemplate failed: ${error.message}`)
}

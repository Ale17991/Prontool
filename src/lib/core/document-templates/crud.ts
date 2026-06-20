import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

export type TemplateDocType = 'atestado' | 'declaracao' | 'receita' | 'laudo' | 'outro'
export type PaperSize = 'A4' | 'A5' | 'LETTER'

export interface DocumentTemplate {
  id: string
  name: string
  docType: TemplateDocType
  body: string
  paperSize: PaperSize
  fontSize: number
}

interface Row {
  id: string
  name: string
  doc_type: TemplateDocType
  body: string
  paper_size: PaperSize
  font_size: number
}

const SELECT = 'id, name, doc_type, body, paper_size, font_size'

function toDto(r: Row): DocumentTemplate {
  return {
    id: r.id,
    name: r.name,
    docType: r.doc_type,
    body: r.body,
    paperSize: r.paper_size,
    fontSize: r.font_size,
  }
}

export async function listTemplates(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string },
): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase
    .from('document_templates' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`listTemplates failed: ${error.message}`)
  return ((data ?? []) as unknown as Row[]).map(toDto)
}

export async function getTemplate(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string },
): Promise<DocumentTemplate | null> {
  const { data, error } = await supabase
    .from('document_templates' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`getTemplate failed: ${error.message}`)
  return data ? toDto(data as unknown as Row) : null
}

export interface UpsertTemplateInput {
  tenantId: string
  actorUserId: string
  name: string
  docType: TemplateDocType
  body: string
  paperSize: PaperSize
  fontSize: number
}

function validate(input: UpsertTemplateInput) {
  if (input.name.trim().length < 1) throw new ValidationError('Nome do modelo é obrigatório.')
  if (input.body.trim().length < 1) throw new ValidationError('Conteúdo do modelo é obrigatório.')
  if (input.fontSize < 8 || input.fontSize > 18) throw new ValidationError('Fonte entre 8 e 18.')
}

export async function createTemplate(
  supabase: SupabaseClient<Database>,
  input: UpsertTemplateInput,
): Promise<{ id: string }> {
  validate(input)
  const { data, error } = await supabase
    .from('document_templates' as never)
    .insert({
      tenant_id: input.tenantId,
      name: input.name.trim(),
      doc_type: input.docType,
      body: input.body.trim(),
      paper_size: input.paperSize,
      font_size: input.fontSize,
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`createTemplate failed: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function updateTemplate(
  supabase: SupabaseClient<Database>,
  id: string,
  input: UpsertTemplateInput,
): Promise<void> {
  validate(input)
  const { data, error } = await supabase
    .from('document_templates' as never)
    .update({
      name: input.name.trim(),
      doc_type: input.docType,
      body: input.body.trim(),
      paper_size: input.paperSize,
      font_size: input.fontSize,
      updated_at: new Date().toISOString(),
      updated_by: input.actorUserId,
    } as never)
    .eq('tenant_id', input.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`updateTemplate failed: ${error.message}`)
  if (!data) throw new NotFoundError('document_template', id)
}

export async function softDeleteTemplate(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string; actorUserId: string },
): Promise<void> {
  const { error } = await supabase
    .from('document_templates' as never)
    .update({ deleted_at: new Date().toISOString(), deleted_by: args.actorUserId } as never)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
  if (error) throw new Error(`softDeleteTemplate failed: ${error.message}`)
}

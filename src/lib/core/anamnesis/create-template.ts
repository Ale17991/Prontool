import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

export type AnamnesisFieldType =
  | 'texto_curto'
  | 'texto_longo'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'data'
  | 'numero'

export interface AnamnesisField {
  id: string
  type: AnamnesisFieldType
  label: string
  required: boolean
  options?: string[]
  /**
   * Marca campos pré-populados pelo builder (nome, CPF, endereço, etc.) que
   * devem ser pré-preenchidos a partir do cadastro do paciente quando a
   * anamnese é aplicada.
   */
  is_default?: boolean
}

export interface CreateTemplateInput {
  tenantId: string
  title: string
  description?: string | null
  fields: AnamnesisField[]
  actorUserId: string
  previousVersionId?: string | null
}

export async function createAnamnesisTemplate(
  supabase: SupabaseClient<Database>,
  input: CreateTemplateInput,
) {
  if (input.title.trim().length < 1) throw new ValidationError('Título obrigatório')
  if (input.fields.length === 0) {
    throw new ValidationError('O modelo precisa ter ao menos um campo')
  }
  for (const f of input.fields) {
    if (!f.label.trim()) throw new ValidationError('Todo campo precisa de um label')
    if (['radio', 'select', 'checkbox'].includes(f.type)) {
      if (!f.options || f.options.length === 0) {
        throw new ValidationError(`Campo "${f.label}" precisa de ao menos uma opção`)
      }
    }
  }

  // Versão: nova se não tem previous; previous.version + 1 se for edição.
  let version = 1
  if (input.previousVersionId) {
    const { data: prev } = await supabase
      .from('anamnesis_templates')
      .select('version')
      .eq('id', input.previousVersionId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle()
    if (prev) version = prev.version + 1
  }

  const { data, error } = await supabase
    .from('anamnesis_templates')
    .insert({
      tenant_id: input.tenantId,
      title: input.title.trim(),
      description: input.description ?? null,
      version,
      previous_version_id: input.previousVersionId ?? null,
      fields: input.fields as unknown as Database['public']['Tables']['anamnesis_templates']['Insert']['fields'],
      created_by: input.actorUserId,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError(
        `Já existe uma versão v${version} do modelo "${input.title}"`,
      )
    }
    throw new Error(`createAnamnesisTemplate failed: ${error.message}`)
  }
  return data
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

export interface ApplyAnamnesisInput {
  tenantId: string
  patientId: string
  templateId: string
  responses: Record<string, unknown>
  actorUserId: string
}

/**
 * Aplica um modelo de anamnese ao paciente: cria um clinical_records com
 * `type='anamnese'` e `anamnesis_data` contendo o snapshot do template
 * (id, versão, fields) + as respostas. O snapshot é congelado aqui para
 * que alterações futuras no template não mudem anamneses antigas.
 */
export async function applyAnamnesisToPatient(
  supabase: SupabaseClient<Database>,
  input: ApplyAnamnesisInput,
) {
  const { data: template, error: tErr } = await supabase
    .from('anamnesis_templates')
    .select('id, tenant_id, title, version, fields, active')
    .eq('id', input.templateId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()

  if (tErr) throw new Error(`apply anamnesis lookup failed: ${tErr.message}`)
  if (!template) throw new NotFoundError('anamnesis_template', input.templateId)
  if (!template.active) {
    throw new ValidationError(
      'Modelo de anamnese inativo — reative em Cadastros → Modelos de Anamnese ou escolha outro.',
    )
  }

  // Validação básica dos obrigatórios antes do insert — o CHECK do DB só
  // garante que o JSONB está presente, não que os required estão preenchidos.
  const fields = template.fields as unknown as Array<{
    id: string
    label: string
    required: boolean
  }>
  const missing = fields
    .filter((f) => f.required && !input.responses[f.id])
    .map((f) => f.label)
  if (missing.length > 0) {
    throw new ValidationError(
      `Campos obrigatórios não preenchidos: ${missing.join(', ')}`,
    )
  }

  const { data, error } = await supabase
    .from('clinical_records')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      title: `Anamnese — ${template.title} (v${template.version})`,
      type: 'anamnese',
      anamnesis_data: {
        template_id: template.id,
        template_version: template.version,
        template_title: template.title,
        fields: template.fields,
        responses: input.responses,
      } as unknown as Database['public']['Tables']['clinical_records']['Insert']['anamnesis_data'],
      created_by: input.actorUserId,
    })
    .select('id, created_at')
    .single()

  if (error) throw new Error(`applyAnamnesisToPatient failed: ${error.message}`)
  return data
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { createAllergy, listAllergies } from '@/lib/core/patient-medical/allergies'

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
 *
 * Side effect: se a anamnese tem `default_alergias` preenchido E o
 * paciente AINDA NÃO tem alergias registradas em `patient_allergies`,
 * cria entries automaticamente parseando o texto livre (heurística:
 * uma alergia por linha/`;`/`,`, severity='moderada' default). Não
 * sobrescreve registros existentes — fluxo é idempotente em re-aplicações.
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

  // Side effect: criar entries em patient_allergies a partir do
  // default_alergias se paciente ainda não tem alergias cadastradas.
  // Falha aqui é registrada via console.error mas não derruba a anamnese
  // (que já foi salva). Idempotente entre reaplicações: se já existem
  // alergias, simplesmente não cria nada.
  await maybeCreateAllergiesFromAnamnese(supabase, input)

  return data
}

const ALLERGY_NEGATION_PATTERNS = [
  /^nenhuma/i,
  /^não\s/i,
  /^nao\s/i,
  /^sem\s+aler/i,
  /^nkda/i,
  /^n\/a/i,
  /^—$/,
  /^-$/,
]

async function maybeCreateAllergiesFromAnamnese(
  supabase: SupabaseClient<Database>,
  input: ApplyAnamnesisInput,
): Promise<void> {
  const text = input.responses['default_alergias']
  if (typeof text !== 'string' || !text.trim()) return

  // Curto-circuita se o texto sinaliza ausência de alergias.
  const trimmed = text.trim()
  if (ALLERGY_NEGATION_PATTERNS.some((re) => re.test(trimmed))) return

  // Se já tem alergias ativas, não cria nada (não duplica).
  let existing
  try {
    existing = await listAllergies(supabase, {
      tenantId: input.tenantId,
      patientId: input.patientId,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('apply-anamnese: listAllergies failed', err)
    return
  }
  if (existing.length > 0) return

  // Parse: split por \n, ;, vírgula. Cada item é uma alergia separada.
  const items = trimmed
    .split(/[\n;]+|,(?![^()]*\))/g) // split em \n, ; e em vírgulas que não estão dentro de parênteses
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !ALLERGY_NEGATION_PATTERNS.some((re) => re.test(s)))

  for (const item of items) {
    // Tenta extrair severidade entre parênteses, ex.: "Dipirona (grave)".
    const severityMatch = item.match(/\((leve|moderada|grave)\)/i)
    const severity = (severityMatch?.[1]?.toLowerCase() ?? 'moderada') as
      | 'leve'
      | 'moderada'
      | 'grave'
    // Substância = texto sem o sufixo "(severity)" e sem hifenação descrita.
    const substance = item
      .replace(/\((leve|moderada|grave)\)/i, '')
      .replace(/—.*$/, '') // remove tudo após em-dash (notes da formatação prefill)
      .replace(/\s*-\s+.*$/, '') // remove " - notes" pattern
      .trim()
    if (!substance) continue

    try {
      await createAllergy(supabase, {
        tenantId: input.tenantId,
        patientId: input.patientId,
        actorUserId: input.actorUserId,
        substance: substance.slice(0, 200), // CHECK no banco limita 1-200
        severity,
        notes: null,
      })
    } catch (err) {
      // Se uma alergia falhar (ex.: duplicate por race condition), loga
      // mas continua com as próximas — comportamento best-effort.
      // eslint-disable-next-line no-console
      console.error('apply-anamnese: createAllergy failed', substance, err)
    }
  }
}

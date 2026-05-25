import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import {
  createPatientManually,
  type CreateManualPatientAddress,
  type CreateManualPatientResult,
} from './create-manual'
import { applyAnamnesisToPatient } from '@/lib/core/anamnesis/apply-to-patient'
import { listPatients } from './list'

/**
 * Cria paciente + anamnese em um único fluxo. Extrai os campos
 * is_default das responses pra montar o paciente, dedupe por CPF e
 * congela o snapshot da anamnese em clinical_records (mesma lógica do
 * applyAnamnesisToPatient).
 *
 * O dedup por CPF lê via list_patients_for_tenant (que decripta em TS)
 * e procura match exato. Acceptable pra tenants até ~10k pacientes.
 */
export interface CreatePatientWithAnamnesisInput {
  tenantId: string
  templateId: string
  responses: Record<string, unknown>
  /** plan_id explícito do paciente (Select da UI), separado do response default_plano. */
  patientPlanId?: string | null
  actorUserId: string
}

export interface CreatePatientWithAnamnesisResult {
  patientId: string
  recordId: string
  patientCreate: CreateManualPatientResult
}

export async function createPatientWithAnamnesis(
  supabase: SupabaseClient<Database>,
  input: CreatePatientWithAnamnesisInput,
): Promise<CreatePatientWithAnamnesisResult> {
  // 1. Carrega o template e valida obrigatórios.
  const tpl = await supabase
    .from('anamnesis_templates')
    .select('id, tenant_id, title, version, fields, active')
    .eq('id', input.templateId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (tpl.error) throw new Error(`template lookup: ${tpl.error.message}`)
  if (!tpl.data) throw new NotFoundError('anamnesis_template', input.templateId)
  if (!tpl.data.active) {
    throw new ValidationError(
      'Modelo de anamnese inativo — escolha outro ou crie sem modelo.',
    )
  }

  const fields = tpl.data.fields as unknown as Array<{
    id: string
    label: string
    required: boolean
    is_default?: boolean
  }>

  // 2. Extrai dados do paciente dos campos is_default.
  const fullName = pickString(input.responses, 'default_nome')
  const cpfRaw = pickString(input.responses, 'default_cpf')
  if (!fullName || fullName.length < 2) {
    throw new ValidationError('Nome completo é obrigatório')
  }
  // CPF opcional em fase de testes. Quando preenchido, exige 11 digitos +
  // dedup; quando vazio, segue sem CPF.
  const cpfDigitsRaw = (cpfRaw ?? '').replace(/\D/g, '')
  const cpfDigits: string | null =
    cpfDigitsRaw.length === 0 ? null : cpfDigitsRaw
  if (cpfDigits !== null && cpfDigits.length !== 11) {
    throw new ValidationError(
      'CPF deve ter 11 dígitos quando preenchido (ou pode ser deixado em branco).',
    )
  }

  // 3. Dedup CPF dentro do tenant (apenas se CPF foi informado).
  if (cpfDigits !== null) {
    const existing = await findPatientByCpf(supabase, input.tenantId, cpfDigits)
    if (existing) {
      throw new ConflictError(
        'PATIENT_CPF_DUPLICATE',
        'Paciente com este CPF já existe nesta clínica',
        { patient_id: existing.id, full_name: existing.fullName },
      )
    }
  }

  // 4. Valida obrigatórios da anamnese (default OU custom). CPF opcional
  // em fase de testes — ignorado mesmo se o template marcar como required.
  const missing = fields
    .filter((f) => f.required && f.id !== 'default_cpf')
    .filter((f) => isResponseEmpty(input.responses[f.id]))
    .map((f) => f.label)
  if (missing.length > 0) {
    throw new ValidationError(
      `Campos obrigatórios não preenchidos: ${missing.join(', ')}`,
    )
  }

  // 5. Cria paciente. plan_id explícito (Select UI) tem prioridade sobre
  //    o texto livre do default_plano. CEP/endereço default_* são salvos
  //    apenas no snapshot da anamnese — endereço estruturado fica pra
  //    edição posterior na ficha.
  const phone = pickString(input.responses, 'default_telefone')
  const email = pickString(input.responses, 'default_email')
  const birthDate = pickString(input.responses, 'default_data_nasc')
  const cep = pickString(input.responses, 'default_cep')
  const enderecoFreeText = pickString(input.responses, 'default_endereco')

  const address: CreateManualPatientAddress | undefined =
    cep || enderecoFreeText
      ? {
          cep: cep ?? null,
          // O default_endereco é texto livre — guardamos no campo street
          // pra preservar dado, sem tentar parsear em rua/número/bairro.
          street: enderecoFreeText ?? null,
        }
      : undefined

  const patientCreate = await createPatientManually(supabase, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    fullName,
    cpf: cpfDigits, // string | null — pacientes sem CPF passam null
    phone: phone ?? undefined,
    email: email ?? undefined,
    birthDate: birthDate ?? undefined,
    planId: input.patientPlanId ?? null,
    address,
  })

  // 6. Aplica anamnese ao novo paciente.
  const record = await applyAnamnesisToPatient(supabase, {
    tenantId: input.tenantId,
    patientId: patientCreate.patientId,
    templateId: input.templateId,
    responses: input.responses,
    actorUserId: input.actorUserId,
  })

  return {
    patientId: patientCreate.patientId,
    recordId: record.id,
    patientCreate,
  }
}

function pickString(
  responses: Record<string, unknown>,
  key: string,
): string | null {
  const v = responses[key]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isResponseEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

async function findPatientByCpf(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  cpfDigits: string,
): Promise<{ id: string; fullName: string } | null> {
  // listPatients busca por substring de fullName OU cpf decriptado em TS.
  // Filtramos resultado por match exato.
  const { items } = await listPatients(supabase, {
    tenantId,
    search: cpfDigits,
    pageSize: 100,
  })
  const exact = items.find((p) => (p.cpf ?? '').replace(/\D/g, '') === cpfDigits)
  if (!exact) return null
  return { id: exact.id, fullName: exact.fullName }
}

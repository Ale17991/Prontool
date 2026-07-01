import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Cria registro de prontuário do tipo `texto`. Para arquivos, usar
 * `createClinicalFileRecord`.
 */
export interface CreateTextRecordInput {
  tenantId: string
  patientId: string
  title: string
  content: string
  actorUserId: string
}

export interface AnamnesisFieldSnapshot {
  id: string
  type: string
  label: string
  required?: boolean
  options?: string[]
  is_default?: boolean
}

export interface AnamnesisSnapshot {
  template_id: string
  template_version: number
  template_title: string
  fields: AnamnesisFieldSnapshot[]
  responses: Record<string, unknown>
}

export interface SoapDiagnosisCid {
  code: string
  description: string
}

export interface SoapData {
  subjective: string
  objective: string | null
  assessment: string
  plan: string | null
  /** CIDs vinculados à seção Avaliação. */
  assessment_cids?: SoapDiagnosisCid[]
}

export interface ClinicalRecordRow {
  id: string
  tenantId: string
  patientId: string
  title: string
  type: 'texto' | 'arquivo' | 'anamnese' | 'evolucao'
  content: string | null
  fileName: string | null
  fileUrl: string | null
  fileSizeBytes: number | null
  anamnesisData: AnamnesisSnapshot | null
  soapData: SoapData | null
  createdBy: string
  createdAt: string
  deletedAt: string | null
}

export async function createTextClinicalRecord(
  supabase: SupabaseClient<Database>,
  input: CreateTextRecordInput,
): Promise<ClinicalRecordRow> {
  if (!input.content.trim()) throw new ValidationError('content não pode ser vazio')

  await assertPatientInTenant(supabase, input.tenantId, input.patientId)

  const { data, error } = await supabase
    .from('clinical_records')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      title: input.title,
      type: 'texto',
      content: input.content,
      created_by: input.actorUserId,
    })
    .select(
      'id, tenant_id, patient_id, title, type, content, file_name, file_url, file_size_bytes, created_by, created_at, deleted_at',
    )
    .single()
  if (error || !data) throw new Error(`createTextClinicalRecord failed: ${error?.message}`)
  return mapRow(data)
}

export interface CreateFileRecordInput {
  tenantId: string
  patientId: string
  title: string
  fileName: string
  fileUrl: string
  fileSizeBytes: number
  actorUserId: string
}

export interface CreateEvolutionRecordInput {
  tenantId: string
  patientId: string
  title: string
  soap: SoapData
  actorUserId: string
}

/**
 * Cria uma evolução clínica em formato SOAP. soap_data + assessment_cids
 * gravados em colunas JSONB separadas (plaintext — texto SOAP é dado
 * clínico, não PII de identificação). Cada validação de obrigatório
 * (S, A) acontece aqui antes do insert.
 */
export async function createEvolutionRecord(
  supabase: SupabaseClient<Database>,
  input: CreateEvolutionRecordInput,
): Promise<ClinicalRecordRow> {
  if (!input.soap.subjective.trim()) {
    throw new ValidationError('Campo Subjetivo (S) é obrigatório')
  }
  if (!input.soap.assessment.trim()) {
    throw new ValidationError('Campo Avaliação (A) é obrigatório')
  }
  await assertPatientInTenant(supabase, input.tenantId, input.patientId)

  const cids = input.soap.assessment_cids ?? []
  const normalized: SoapData = {
    subjective: input.soap.subjective.trim(),
    objective: input.soap.objective?.trim() || null,
    assessment: input.soap.assessment.trim(),
    plan: input.soap.plan?.trim() || null,
    assessment_cids: cids,
  }

  const { data, error } = await supabase
    .from('clinical_records')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      title: input.title,
      type: 'evolucao',
      soap_data:
        normalized as unknown as Database['public']['Tables']['clinical_records']['Insert']['soap_data'],
      assessment_cids:
        cids as unknown as Database['public']['Tables']['clinical_records']['Insert']['assessment_cids'],
      created_by: input.actorUserId,
    })
    .select(
      'id, tenant_id, patient_id, title, type, content, file_name, file_url, file_size_bytes, soap_data, assessment_cids, created_by, created_at, deleted_at',
    )
    .single()
  if (error || !data) {
    throw new Error(`createEvolutionRecord failed: ${error?.message}`)
  }
  return mapRow({ ...data, anamnesis_data: null })
}

export async function createClinicalFileRecord(
  supabase: SupabaseClient<Database>,
  input: CreateFileRecordInput,
): Promise<ClinicalRecordRow> {
  await assertPatientInTenant(supabase, input.tenantId, input.patientId)

  const { data, error } = await supabase
    .from('clinical_records')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      title: input.title,
      type: 'arquivo',
      file_name: input.fileName,
      file_url: input.fileUrl,
      file_size_bytes: input.fileSizeBytes,
      created_by: input.actorUserId,
    })
    .select(
      'id, tenant_id, patient_id, title, type, content, file_name, file_url, file_size_bytes, created_by, created_at, deleted_at',
    )
    .single()
  if (error || !data) throw new Error(`createClinicalFileRecord failed: ${error?.message}`)
  return mapRow(data)
}

async function assertPatientInTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('patients')
    .select('id')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`patient lookup failed: ${error.message}`)
  if (!data) throw new NotFoundError('patient', patientId)
}

interface DbRow {
  id: string
  tenant_id: string
  patient_id: string
  title: string
  type: string
  content: string | null
  file_name: string | null
  file_url: string | null
  file_size_bytes: number | null
  anamnesis_data?: unknown
  soap_data?: unknown
  assessment_cids?: unknown
  created_by: string
  created_at: string
  deleted_at: string | null
}

function mapRow(r: DbRow): ClinicalRecordRow {
  const soap = (r.soap_data ?? null) as SoapData | null
  return {
    id: r.id,
    tenantId: r.tenant_id,
    patientId: r.patient_id,
    title: r.title,
    type: r.type as 'texto' | 'arquivo' | 'anamnese' | 'evolucao',
    content: r.content,
    fileName: r.file_name,
    fileUrl: r.file_url,
    fileSizeBytes: r.file_size_bytes,
    anamnesisData: (r.anamnesis_data ?? null) as AnamnesisSnapshot | null,
    soapData: soap,
    createdBy: r.created_by,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { AnamnesisSnapshot, ClinicalRecordRow, SoapData } from './create'

/**
 * Lista registros clínicos do paciente, ordem decrescente por
 * `created_at`. Por default exclui registros soft-deletados.
 *
 * soap_data e assessment_cids são lidos como JSONB diretos (plaintext —
 * texto clínico não é PII de identificação, fica em claro pra simplificar
 * busca).
 */
export interface ListClinicalRecordsInput {
  tenantId: string
  patientId: string
  includeDeleted?: boolean
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
  anamnesis_data: unknown
  soap_data: unknown
  created_by: string
  created_at: string
  deleted_at: string | null
}

export async function listClinicalRecords(
  supabase: SupabaseClient<Database>,
  input: ListClinicalRecordsInput,
): Promise<ClinicalRecordRow[]> {
  let q = supabase
    .from('clinical_records')
    .select(
      'id, tenant_id, patient_id, title, type, content, file_name, file_url, file_size_bytes, anamnesis_data, soap_data, created_by, created_at, deleted_at',
    )
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .order('created_at', { ascending: false })

  if (!input.includeDeleted) q = q.is('deleted_at', null)

  const { data, error } = await q
  if (error) throw new Error(`listClinicalRecords failed: ${error.message}`)

  return ((data ?? []) as unknown as DbRow[]).map((r) => ({
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
    soapData: (r.soap_data ?? null) as SoapData | null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }))
}

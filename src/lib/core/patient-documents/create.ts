import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

export type PatientDocType = 'atestado' | 'declaracao' | 'outro'

export interface CreatePatientDocumentInput {
  tenantId: string
  patientId: string
  actorUserId: string
  docType: PatientDocType
  title: string
  body: string
  /** Backlog 1/10 — CID opcional. */
  cidCode?: string | null
  cidDescription?: string | null
}

export async function createPatientDocument(
  supabase: SupabaseClient<Database>,
  input: CreatePatientDocumentInput,
): Promise<{ id: string }> {
  const title = input.title.trim()
  const body = input.body.trim()
  if (title.length < 1 || title.length > 200) throw new ValidationError('Título inválido.')
  if (body.length < 1 || body.length > 8000) throw new ValidationError('Conteúdo inválido.')

  const { data, error } = await supabase
    .from('patient_documents' as never)
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      doc_type: input.docType,
      title,
      body,
      cid_code: input.cidCode?.trim() || null,
      cid_description: input.cidDescription?.trim() || null,
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`createPatientDocument failed: ${error.message}`)

  await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: null,
    entity: 'patient_documents',
    entity_id: (data as { id: string }).id,
    field: 'created',
    old_value: null,
    new_value: input.docType,
    reason: 'documento emitido via /api/pacientes/[id]/documentos POST',
    result: 'success',
  } as never)

  return { id: (data as { id: string }).id }
}

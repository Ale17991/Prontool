import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { PatientDocType } from './create'

export interface PatientDocumentRow {
  id: string
  docType: PatientDocType
  title: string
  body: string
  cidCode: string | null
  cidDescription: string | null
  issuedAt: string | null
  /** Backlog 1/4/2 — marcação manual de entrega ao paciente. */
  deliveredAt: string | null
  createdAt: string
  paperSize: 'A4' | 'A5' | 'LETTER'
  fontSize: number
}

const SELECT =
  'id, doc_type, title, body, cid_code, cid_description, issued_at, delivered_at, created_at, paper_size, font_size'

export async function listPatientDocuments(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<PatientDocumentRow[]> {
  const { data, error } = await supabase
    .from('patient_documents' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listPatientDocuments failed: ${error.message}`)

  return ((data ?? []) as unknown as Array<{
    id: string
    doc_type: PatientDocType
    title: string
    body: string
    cid_code: string | null
    cid_description: string | null
    issued_at: string | null
    delivered_at: string | null
    created_at: string
    paper_size: 'A4' | 'A5' | 'LETTER'
    font_size: number
  }>).map((r) => ({
    id: r.id,
    docType: r.doc_type,
    title: r.title,
    body: r.body,
    cidCode: r.cid_code,
    cidDescription: r.cid_description,
    issuedAt: r.issued_at,
    deliveredAt: r.delivered_at,
    createdAt: r.created_at,
    paperSize: r.paper_size,
    fontSize: r.font_size,
  }))
}

export async function getPatientDocument(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; documentId: string },
): Promise<PatientDocumentRow | null> {
  const { data, error } = await supabase
    .from('patient_documents' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`getPatientDocument failed: ${error.message}`)
  if (!data) return null
  const r = data as unknown as {
    id: string
    doc_type: PatientDocType
    title: string
    body: string
    cid_code: string | null
    cid_description: string | null
    issued_at: string | null
    delivered_at: string | null
    created_at: string
    paper_size: 'A4' | 'A5' | 'LETTER'
    font_size: number
  }
  return {
    id: r.id,
    docType: r.doc_type,
    title: r.title,
    body: r.body,
    cidCode: r.cid_code,
    cidDescription: r.cid_description,
    issuedAt: r.issued_at,
    deliveredAt: r.delivered_at,
    createdAt: r.created_at,
    paperSize: r.paper_size,
    fontSize: r.font_size,
  }
}

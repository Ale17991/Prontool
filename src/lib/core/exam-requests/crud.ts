import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

/** Item solicitado: snapshot {code, description}. `code` nulo = exame em texto livre. */
export interface ExamRequestItem {
  code: string | null
  description: string
}

export interface ExamRequest {
  id: string
  items: ExamRequestItem[]
  clinicalIndication: string | null
  notes: string | null
  appointmentId: string | null
  issuedAt: string | null
  createdAt: string
}

export interface CreateExamRequestInput {
  tenantId: string
  patientId: string
  actorUserId: string
  items: ExamRequestItem[]
  clinicalIndication?: string | null
  notes?: string | null
  appointmentId?: string | null
  doctorId?: string | null
}

const SELECT = 'id, items, clinical_indication, notes, appointment_id, issued_at, created_at'

function toDto(r: Record<string, unknown>): ExamRequest {
  const rawItems = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : []
  return {
    id: r.id as string,
    items: rawItems.map((i) => ({
      code: (i.code as string | null) ?? null,
      description: String(i.description ?? ''),
    })),
    clinicalIndication: (r.clinical_indication as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    appointmentId: (r.appointment_id as string | null) ?? null,
    issuedAt: (r.issued_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

function normalizeItems(items: ExamRequestItem[]): ExamRequestItem[] {
  const cleaned = items
    .map((i) => ({
      code: i.code?.trim() ? i.code.trim() : null,
      description: (i.description ?? '').trim(),
    }))
    .filter((i) => i.description.length > 0)
  if (cleaned.length < 1) throw new ValidationError('Adicione ao menos um exame.')
  if (cleaned.length > 50) throw new ValidationError('Máximo de 50 exames por solicitação.')
  for (const i of cleaned) {
    if (i.description.length > 300) throw new ValidationError('Descrição do exame muito longa.')
  }
  return cleaned
}

export async function createExamRequest(
  supabase: SupabaseClient<Database>,
  input: CreateExamRequestInput,
): Promise<{ id: string }> {
  const items = normalizeItems(input.items)
  const indication = input.clinicalIndication?.trim() || null
  const notes = input.notes?.trim() || null
  if (indication && indication.length > 4000)
    throw new ValidationError('Indicação clínica muito longa.')
  if (notes && notes.length > 2000) throw new ValidationError('Observações muito longas.')

  const { data, error } = await supabase
    .from('exam_requests' as never)
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      appointment_id: input.appointmentId ?? null,
      doctor_id: input.doctorId ?? null,
      items: items as never,
      clinical_indication: indication,
      notes,
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`createExamRequest failed: ${error.message}`)

  const id = (data as { id: string }).id
  await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: null,
    entity: 'exam_requests',
    entity_id: id,
    field: 'created',
    old_value: null,
    new_value: String(items.length),
    reason: 'solicitação de exame via /api/pacientes/[id]/solicitacoes-exame POST',
    result: 'success',
  } as never)

  return { id }
}

export async function listExamRequests(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<ExamRequest[]> {
  const { data, error } = await supabase
    .from('exam_requests' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listExamRequests failed: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toDto)
}

export async function getExamRequest(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string },
): Promise<ExamRequest | null> {
  const { data, error } = await supabase
    .from('exam_requests' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`getExamRequest failed: ${error.message}`)
  return data ? toDto(data as unknown as Record<string, unknown>) : null
}

export async function softDeleteExamRequest(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string; actorUserId: string },
): Promise<void> {
  const { error } = await supabase
    .from('exam_requests' as never)
    .update({ deleted_at: new Date().toISOString(), deleted_by: args.actorUserId } as never)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .is('deleted_at', null)
  if (error) throw new Error(`softDeleteExamRequest failed: ${error.message}`)
}

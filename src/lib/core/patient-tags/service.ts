import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { isPatientTagColor, type PatientTagColor } from './palette'

/**
 * As tabelas patient_tags e patient_tag_assignments foram criadas em
 * 0103 mas ainda não estão refletidas em `Database` (gen-types depende
 * de Docker local). Até a próxima execução de `pnpm supabase:gen-types`,
 * o helper abaixo faz cast para um cliente destipado nas tabelas novas.
 * O runtime continua funcionando porque o cliente Supabase é dinâmico.
 */
type UntypedFrom = (table: string) => ReturnType<SupabaseClient['from']>
function untyped(supabase: SupabaseClient<Database>): { from: UntypedFrom } {
  return supabase as unknown as { from: UntypedFrom }
}

/**
 * SQLSTATE 42P01 = "relation does not exist". Acontece quando a 0103 ainda
 * não foi aplicada em algum ambiente (deploy novo antes de migrar o DB).
 * Para os reads bulk (listas/typeahead), tratamos como "sem tags" em vez
 * de quebrar o request inteiro. Para os writes, propaga (UI mostra erro).
 */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === '42P01' || /relation .* does not exist/i.test(err.message ?? '')
}

export interface PatientTag {
  id: string
  tenantId: string
  name: string
  color: PatientTagColor
  createdAt: string
  updatedAt: string
}

export interface PatientTagAssignment {
  patientId: string
  tag: PatientTag
}

interface TagRow {
  id: string
  tenant_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
}

function toTag(row: TagRow): PatientTag {
  if (!isPatientTagColor(row.color)) {
    // Estado impossível em runtime (CHECK constraint protege), mas mantém
    // o tipo honesto sem cast cego.
    throw new Error(`patient_tags: cor inválida persistida: ${row.color}`)
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export async function listPatientTags(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PatientTag[]> {
  const { data, error } = await untyped(supabase)
    .from('patient_tags')
    .select('id, tenant_id, name, color, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(`list patient_tags failed: ${error.message}`)
  }
  return ((data ?? []) as TagRow[]).map(toTag)
}

export async function createPatientTag(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; actorUserId: string; name: string; color: string },
): Promise<PatientTag> {
  const name = normalizeName(args.name)
  if (name.length < 1 || name.length > 40) {
    throw new ValidationError('Nome da tag deve ter entre 1 e 40 caracteres.')
  }
  if (!isPatientTagColor(args.color)) {
    throw new ValidationError('Cor inválida.')
  }

  const { data, error } = await untyped(supabase)
    .from('patient_tags')
    .insert({
      tenant_id: args.tenantId,
      name,
      color: args.color,
      created_by: args.actorUserId,
    })
    .select('id, tenant_id, name, color, created_at, updated_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('TAG_NAME_TAKEN', 'Já existe uma tag com esse nome.')
    }
    throw new Error(`create patient_tag failed: ${error.message}`)
  }
  return toTag(data as TagRow)
}

export async function updatePatientTag(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    tagId: string
    name?: string
    color?: string
  },
): Promise<PatientTag> {
  const patch: Record<string, string> = {}
  if (args.name !== undefined) {
    const name = normalizeName(args.name)
    if (name.length < 1 || name.length > 40) {
      throw new ValidationError('Nome da tag deve ter entre 1 e 40 caracteres.')
    }
    patch.name = name
  }
  if (args.color !== undefined) {
    if (!isPatientTagColor(args.color)) {
      throw new ValidationError('Cor inválida.')
    }
    patch.color = args.color
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nada para atualizar.')
  }

  const { data, error } = await untyped(supabase)
    .from('patient_tags')
    .update(patch)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.tagId)
    .select('id, tenant_id, name, color, created_at, updated_at')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('TAG_NAME_TAKEN', 'Já existe uma tag com esse nome.')
    }
    throw new Error(`update patient_tag failed: ${error.message}`)
  }
  if (!data) throw new NotFoundError('patient_tag', args.tagId)
  return toTag(data as TagRow)
}

export async function deletePatientTag(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; tagId: string },
): Promise<void> {
  const { error, count } = await untyped(supabase)
    .from('patient_tags')
    .delete({ count: 'exact' })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.tagId)
  if (error) throw new Error(`delete patient_tag failed: ${error.message}`)
  if ((count ?? 0) === 0) throw new NotFoundError('patient_tag', args.tagId)
}

/**
 * Busca todas as tags atribuídas a um paciente.
 *
 * Implementação com 2 queries (em vez de embed PostgREST) porque o embed
 * em alguns ambientes Supabase deduplica linhas ao agrupar pelo lado N=1,
 * deixando o paciente com apenas a primeira tag. Duas queries explícitas
 * são previsíveis e baratas (índices em patient_id e tag_id).
 */
export async function listTagsForPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<PatientTag[]> {
  const { data: assignments, error: assignErr } = await untyped(supabase)
    .from('patient_tag_assignments')
    .select('tag_id')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
  if (assignErr) {
    if (isMissingTable(assignErr)) return []
    throw new Error(`list assignments for patient failed: ${assignErr.message}`)
  }
  const tagIds = ((assignments ?? []) as Array<{ tag_id: string }>).map((a) => a.tag_id)
  if (tagIds.length === 0) return []

  const { data: tags, error: tagsErr } = await untyped(supabase)
    .from('patient_tags')
    .select('id, tenant_id, name, color, created_at, updated_at')
    .eq('tenant_id', args.tenantId)
    .in('id', tagIds)
  if (tagsErr) {
    if (isMissingTable(tagsErr)) return []
    throw new Error(`fetch tags by id failed: ${tagsErr.message}`)
  }
  return ((tags ?? []) as TagRow[]).map(toTag).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Bulk: tags por paciente para uma lista de patientIds. Usado pela
 * listagem de pacientes para evitar N+1.
 *
 * Mesma motivação do single: 2 queries puras em vez de embed PostgREST
 * que pode reduzir o resultado a 1 tag por paciente.
 */
export async function listTagsForPatients(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientIds: string[] },
): Promise<Map<string, PatientTag[]>> {
  const result = new Map<string, PatientTag[]>()
  if (args.patientIds.length === 0) return result

  const { data: assignments, error: assignErr } = await untyped(supabase)
    .from('patient_tag_assignments')
    .select('patient_id, tag_id')
    .eq('tenant_id', args.tenantId)
    .in('patient_id', args.patientIds)
  if (assignErr) {
    if (isMissingTable(assignErr)) return result
    throw new Error(`bulk assignments for patients failed: ${assignErr.message}`)
  }
  const rows = (assignments ?? []) as Array<{ patient_id: string; tag_id: string }>
  if (rows.length === 0) return result

  const tagIds = Array.from(new Set(rows.map((r) => r.tag_id)))
  const { data: tags, error: tagsErr } = await untyped(supabase)
    .from('patient_tags')
    .select('id, tenant_id, name, color, created_at, updated_at')
    .eq('tenant_id', args.tenantId)
    .in('id', tagIds)
  if (tagsErr) {
    if (isMissingTable(tagsErr)) return result
    throw new Error(`bulk fetch tags by id failed: ${tagsErr.message}`)
  }
  const tagById = new Map<string, PatientTag>()
  for (const t of (tags ?? []) as TagRow[]) {
    tagById.set(t.id, toTag(t))
  }

  for (const row of rows) {
    const tag = tagById.get(row.tag_id)
    if (!tag) continue
    const existing = result.get(row.patient_id) ?? []
    existing.push(tag)
    result.set(row.patient_id, existing)
  }
  for (const [id, tags] of result.entries()) {
    tags.sort((a, b) => a.name.localeCompare(b.name))
    result.set(id, tags)
  }
  return result
}

export async function assignTagToPatient(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    actorUserId: string
    patientId: string
    tagId: string
  },
): Promise<void> {
  const { error } = await untyped(supabase).from('patient_tag_assignments').insert({
    tenant_id: args.tenantId,
    patient_id: args.patientId,
    tag_id: args.tagId,
    created_by: args.actorUserId,
  })
  if (error) {
    if (error.code === '23505') {
      // Já estava atribuída — idempotente, não é erro.
      return
    }
    if (error.code === '23503') {
      throw new NotFoundError('patient_tag', args.tagId)
    }
    throw new Error(`assign tag failed: ${error.message}`)
  }
}

export async function unassignTagFromPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; tagId: string },
): Promise<void> {
  const { error } = await untyped(supabase)
    .from('patient_tag_assignments')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('tag_id', args.tagId)
  if (error) throw new Error(`unassign tag failed: ${error.message}`)
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/observability/errors'
import {
  isPatientTagColor,
  type PatientTagColor,
} from './palette'

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
  if (error) throw new Error(`list patient_tags failed: ${error.message}`)
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
 */
export async function listTagsForPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<PatientTag[]> {
  const { data, error } = await untyped(supabase)
    .from('patient_tag_assignments')
    .select(
      'patient_tags:tag_id ( id, tenant_id, name, color, created_at, updated_at )',
    )
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
  if (error) throw new Error(`list tags for patient failed: ${error.message}`)

  // Supabase tipa o embed como array, mas como tag_id é FK 1:1, o runtime
  // devolve objeto único — daí o cast via unknown.
  const rows = (data ?? []) as unknown as Array<{ patient_tags: TagRow | null }>
  return rows
    .map((r) => r.patient_tags)
    .filter((t): t is TagRow => t !== null)
    .map(toTag)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Bulk: tags por paciente para uma lista de patientIds. Usado pela
 * listagem de pacientes para evitar N+1.
 */
export async function listTagsForPatients(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientIds: string[] },
): Promise<Map<string, PatientTag[]>> {
  const result = new Map<string, PatientTag[]>()
  if (args.patientIds.length === 0) return result

  const { data, error } = await untyped(supabase)
    .from('patient_tag_assignments')
    .select(
      'patient_id, patient_tags:tag_id ( id, tenant_id, name, color, created_at, updated_at )',
    )
    .eq('tenant_id', args.tenantId)
    .in('patient_id', args.patientIds)
  if (error) throw new Error(`bulk tags for patients failed: ${error.message}`)

  for (const row of (data ?? []) as unknown as Array<{
    patient_id: string
    patient_tags: TagRow | null
  }>) {
    if (!row.patient_tags) continue
    const existing = result.get(row.patient_id) ?? []
    existing.push(toTag(row.patient_tags))
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

/**
 * Feature 032 — orientações ao paciente (`patient_care_notes`).
 *
 * Texto que o profissional escreve PARA o paciente. Usado pela equipe (autoria)
 * e pelo portal (leitura, quando a seção `orientacoes` está habilitada).
 * RBAC garantido pelo caller (rota/RLS); escrita = admin/profissional_saude.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface CareNote {
  id: string
  body: string
  createdAt: string
}

// Tabela nova (0117) ainda não tipada nos generated types → cliente solto.
function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

export async function listCareNotes(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<CareNote[]> {
  const { data, error } = await loose(supabase)
    .from('patient_care_notes')
    .select('id, body, created_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`listCareNotes: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; body: string; created_at: string }>).map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
  }))
}

export async function createCareNote(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; body: string; actorUserId: string },
): Promise<{ id: string }> {
  const body = args.body.trim()
  if (body.length === 0 || body.length > 5000) {
    throw new Error('Orientação deve ter entre 1 e 5000 caracteres.')
  }
  const { data, error } = await loose(supabase)
    .from('patient_care_notes')
    .insert({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      body,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createCareNote: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function deleteCareNote(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string },
): Promise<void> {
  const { error } = await loose(supabase)
    .from('patient_care_notes')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
  if (error) throw new Error(`deleteCareNote: ${error.message}`)
}

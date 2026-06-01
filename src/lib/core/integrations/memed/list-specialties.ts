import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getMemedConnection } from './credentials'
import { memedFetch } from './client'
import { MemedNotConnectedError } from './errors'
import { memedSpecialtySchema, type MemedSpecialty } from './types'

/**
 * Proxy de leitura do catálogo de especialidades da Memed (Feature 026, US4),
 * usado no de-para de especialidade ao habilitar um prescritor. Server-side
 * apenas (passa pelo client da cápsula). Parsing defensivo: aceita tanto o
 * shape JSON:API (`{ id, attributes: { nome } }`) quanto `{ id, nome }`.
 */

interface MemedSpecialtyRaw {
  id?: string | number
  nome?: string
  attributes?: { nome?: string }
}

export async function listMemedSpecialties(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<MemedSpecialty[]> {
  const connection = await getMemedConnection(supabase, tenantId)
  if (!connection || !connection.connected) throw new MemedNotConnectedError()

  const res = await memedFetch<{ data?: MemedSpecialtyRaw[] }>(
    connection.environment,
    connection.credentials,
    { method: 'GET', path: '/sinapse-prescricao/especialidades' },
  )

  const items = Array.isArray(res?.data) ? res.data : []
  return items
    .map((item) => ({
      id: item.id !== null && item.id !== undefined ? String(item.id) : '',
      nome: item.attributes?.nome ?? item.nome ?? '',
    }))
    .filter((s) => s.id !== '' && s.nome !== '')
    .map((s) => memedSpecialtySchema.parse(s))
}

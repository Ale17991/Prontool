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

/**
 * Catálogo PÚBLICO da Memed — o endpoint `/especialidades` responde sem auth
 * (confirmado). Usado como fonte ÚNICA da especialidade do médico, independente
 * de a clínica estar conectada à Memed. Degrada para `[]` em falha (nunca lança).
 */
export async function listMemedSpecialtiesPublic(): Promise<MemedSpecialty[]> {
  const base = process.env.MEMED_BASE_URL || 'https://api.memed.com.br/v1'
  try {
    const res = await fetch(`${base}/especialidades`, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: MemedSpecialtyRaw[] }
    const items = Array.isArray(json?.data) ? json.data : []
    return items
      .map((item) => ({
        id: item.id !== null && item.id !== undefined ? String(item.id) : '',
        nome: item.attributes?.nome ?? item.nome ?? '',
      }))
      .filter((s) => s.id !== '' && s.nome !== '')
      .map((s) => memedSpecialtySchema.parse(s))
  } catch {
    return []
  }
}

/** Resolve o id da especialidade no catálogo Memed a partir do NOME exato. */
export async function resolveMemedSpecialtyIdByName(name: string | null): Promise<string | null> {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return null
  const catalog = await listMemedSpecialtiesPublic()
  const hit = catalog.find((s) => s.nome.toLowerCase() === trimmed.toLowerCase())
  return hit?.id ?? null
}

export async function listMemedSpecialties(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<MemedSpecialty[]> {
  const connection = await getMemedConnection(supabase, tenantId)
  if (!connection || !connection.connected) throw new MemedNotConnectedError()

  // Endpoint de catálogo da Memed: GET {base}/especialidades (sem auth, mas as
  // chaves na query são ignoradas). Confirmado na doc da Memed.
  const res = await memedFetch<{ data?: MemedSpecialtyRaw[] }>(
    connection.environment,
    connection.credentials,
    { method: 'GET', path: '/especialidades' },
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

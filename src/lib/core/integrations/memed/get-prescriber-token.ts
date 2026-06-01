import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getMemedConnection } from './credentials'
import { memedFetch, MemedUpstreamError } from './client'
import {
  MemedNotConnectedError,
  MemedPrescriberNotRegisteredError,
  MemedTermsRequiredError,
} from './errors'

/**
 * Busca o token JWT fresco do prescritor (Feature 026, US1).
 * `GET /sinapse-prescricao/usuarios/{external_id}` e devolve APENAS o token —
 * o frontend usa esse token (curto) para inicializar o iframe; as chaves
 * NUNCA saem do servidor.
 */

export interface GetPrescriberTokenInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  doctorId: string
}

interface MemedUsuarioResponse {
  data?: { attributes?: { token?: string } }
}

export async function getPrescriberToken(
  input: GetPrescriberTokenInput,
): Promise<{ token: string }> {
  const { supabase, tenantId, doctorId } = input

  const connection = await getMemedConnection(supabase, tenantId)
  if (!connection || !connection.connected) throw new MemedNotConnectedError()
  // Gating US5: prescrever em produção exige o termo aceito (a constraint já
  // impede produção sem termo, mas falhamos cedo com mensagem clara).
  if (connection.environment === 'production' && !connection.termsAcceptedAt) {
    throw new MemedTermsRequiredError()
  }

  const { data: prescriber, error } = await supabase
    .from('memed_prescribers')
    .select('external_id, status')
    .eq('tenant_id', tenantId)
    .eq('doctor_id', doctorId)
    .maybeSingle()
  if (error) throw new Error(`getPrescriberToken: failed to load prescriber: ${error.message}`)
  if (!prescriber || prescriber.status !== 'registered') {
    throw new MemedPrescriberNotRegisteredError()
  }

  const res = await memedFetch<MemedUsuarioResponse>(connection.environment, connection.credentials, {
    method: 'GET',
    path: `/sinapse-prescricao/usuarios/${encodeURIComponent(prescriber.external_id)}`,
  })

  const token = res?.data?.attributes?.token
  if (!token || typeof token !== 'string') {
    throw new MemedUpstreamError('Memed não retornou o token do prescritor.')
  }
  return { token }
}

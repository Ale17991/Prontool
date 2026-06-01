import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { MemedConfigPublic } from './types'

/**
 * Leitura da conexão Memed para a UI (Feature 026). Seleciona APENAS colunas
 * não-secretas — `api_key_enc`/`secret_key_enc` jamais são lidos aqui, então
 * nada secreto pode vazar para o componente/Server Component.
 */
export async function getMemedConfigPublic(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<MemedConfigPublic | null> {
  const { data, error } = await supabase
    .from('tenant_memed_config')
    .select('environment, connected, terms_accepted_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getMemedConfigPublic failed: ${error.message}`)
  if (!data) return null
  return {
    environment: data.environment as MemedConfigPublic['environment'],
    connected: data.connected,
    termsAcceptedAt: data.terms_accepted_at,
  }
}

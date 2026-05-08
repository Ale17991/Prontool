import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Gera uma URL assinada para um objeto privado do Storage. Retorna `null`
 * em qualquer falha (objeto inexistente, bucket inacessível, network) — o
 * caller decide como degradar (sidebar volta ao fallback de iniciais; PDF
 * imprime aviso "Configure os dados da clínica").
 */
export async function createSignedUrlOrNull(
  supabase: SupabaseClient<Database>,
  bucket: string,
  path: string | null,
  ttlSeconds: number,
): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds)
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}

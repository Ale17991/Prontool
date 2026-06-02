import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { MemedCredentials, MemedEnvironment } from './types'
import { MemedProductionNotConfiguredError } from './errors'

/**
 * Credenciais Memed de PLATAFORMA (modelo de parceiro único: a Clinni é o
 * integrador). As chaves de PRODUÇÃO vêm de env (`MEMED_API_KEY`/
 * `MEMED_SECRET_KEY`), configuradas UMA vez no servidor — nunca por tenant,
 * nunca no banco, nunca no front. Cada clínica apenas ativa + aceita o termo.
 *
 * Homologação usa as chaves PÚBLICAS da doc da Memed (seguras em código
 * backend; substituíveis por env se preciso).
 */

const STAGING_API_KEY = 'iJGiB4kjDGOLeDFPWMG3no9VnN7Abpqe3w1jEFm6olkhkZD6oSfSmYCm'
const STAGING_SECRET_KEY = 'Xe8M5GvBGCr4FStKfxXKisRo3SfYKI7KrTMkJpCAstzu2yXVN4av5nmL'

export interface MemedConnection {
  environment: MemedEnvironment
  connected: boolean
  termsAcceptedAt: string | null
  credentials: MemedCredentials
}

/** As chaves de PRODUÇÃO da Clinni estão configuradas no servidor (env)? */
export function isMemedProductionConfigured(): boolean {
  return Boolean(process.env.MEMED_API_KEY && process.env.MEMED_SECRET_KEY)
}

/**
 * Resolve as credenciais da plataforma para o ambiente. Produção exige as env
 * vars configuradas (senão `MemedProductionNotConfiguredError`).
 */
export function getPlatformMemedCredentials(environment: MemedEnvironment): MemedCredentials {
  if (environment === 'production') {
    const api_key = process.env.MEMED_API_KEY
    const secret_key = process.env.MEMED_SECRET_KEY
    if (!api_key || !secret_key) throw new MemedProductionNotConfiguredError()
    return { api_key, secret_key }
  }
  return {
    api_key: process.env.MEMED_STAGING_API_KEY ?? STAGING_API_KEY,
    secret_key: process.env.MEMED_STAGING_SECRET_KEY ?? STAGING_SECRET_KEY,
  }
}

/**
 * Conexão Memed de um tenant: lê o estado (ativado / ambiente / termo) e
 * resolve as credenciais da plataforma pelo ambiente. `null` se não ativado.
 *
 * O caller é responsável pelo tenant scoping (service client).
 */
export async function getMemedConnection(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<MemedConnection | null> {
  const { data, error } = await supabase
    .from('tenant_memed_config')
    .select('environment, connected, terms_accepted_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`failed to load tenant_memed_config: ${error.message}`)
  if (!data) return null

  const environment = data.environment as MemedEnvironment
  return {
    environment,
    connected: data.connected,
    termsAcceptedAt: data.terms_accepted_at,
    credentials: getPlatformMemedCredentials(environment),
  }
}

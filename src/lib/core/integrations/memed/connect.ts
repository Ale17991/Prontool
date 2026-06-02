import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { encryptMemedCredentials } from './credentials'
import { recordMemedAudit } from './audit'
import type { MemedCredentials, MemedEnvironment } from './types'

/**
 * Conexão da clínica à Memed (Feature 026, US2). Upsert da única linha de
 * `tenant_memed_config` com as chaves cifradas. `connect` sempre grava
 * `staging` — a troca para produção é um caminho separado (US5) que exige
 * termo aceito.
 */

export interface ConnectMemedInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  credentials: MemedCredentials
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface ConnectMemedResult {
  environment: MemedEnvironment
  connected: boolean
}

export async function connectMemed(input: ConnectMemedInput): Promise<ConnectMemedResult> {
  const { supabase, tenantId } = input
  const { api_key_enc, secret_key_enc } = await encryptMemedCredentials(supabase, input.credentials)

  const { error } = await supabase.from('tenant_memed_config').upsert(
    {
      tenant_id: tenantId,
      environment: 'staging',
      api_key_enc,
      secret_key_enc,
      connected: true,
      created_by_user_id: input.actorUserId,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) throw new Error(`connectMemed upsert failed: ${error.message}`)

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'tenant_memed_config',
    entityId: tenantId,
    field: 'memed.connect',
    detail: { environment: 'staging' },
    reason: 'admin conectou a clínica à Memed (homologação)',
    ip: input.ip,
    userAgent: input.userAgent,
  }).catch((err) => logger.error({ err, tenant_id: tenantId }, 'memed-connect-audit-failed'))

  return { environment: 'staging', connected: true }
}

export interface DisconnectMemedInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * Desconecta a clínica. Mantém a linha (e o histórico de aceite de termo)
 * marcando `connected = false`.
 */
export async function disconnectMemed(input: DisconnectMemedInput): Promise<{ connected: false }> {
  const { supabase, tenantId } = input
  const { error } = await supabase
    .from('tenant_memed_config')
    .update({ connected: false })
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`disconnectMemed update failed: ${error.message}`)

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'tenant_memed_config',
    entityId: tenantId,
    field: 'memed.disconnect',
    reason: 'admin desconectou a clínica da Memed',
    ip: input.ip,
    userAgent: input.userAgent,
  }).catch((err) => logger.error({ err, tenant_id: tenantId }, 'memed-disconnect-audit-failed'))

  return { connected: false }
}

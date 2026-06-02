import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { recordMemedAudit } from './audit'
import { isMemedProductionConfigured } from './credentials'
import { MemedProductionNotConfiguredError } from './errors'
import type { MemedEnvironment } from './types'

/**
 * Ativação da prescrição digital por clínica (Feature 026 / modelo de parceiro
 * único). NÃO recebe chaves — as credenciais são de plataforma (env). A clínica
 * apenas lê o termo, confirma e ativa: o aceite é parte da ativação.
 */

export interface ActivateMemedInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  environment: MemedEnvironment
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface ActivateMemedResult {
  environment: MemedEnvironment
  connected: boolean
}

export async function activateMemed(input: ActivateMemedInput): Promise<ActivateMemedResult> {
  const { supabase, tenantId, environment } = input
  if (environment === 'production' && !isMemedProductionConfigured()) {
    throw new MemedProductionNotConfiguredError()
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('tenant_memed_config').upsert(
    {
      tenant_id: tenantId,
      environment,
      connected: true,
      terms_accepted_at: now,
      terms_accepted_by: input.actorUserId,
      created_by_user_id: input.actorUserId,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) throw new Error(`activateMemed upsert failed: ${error.message}`)

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'tenant_memed_config',
    entityId: tenantId,
    field: 'memed.activate',
    detail: { environment },
    reason: `admin ativou a prescrição digital (${environment}) com aceite do termo`,
    ip: input.ip,
    userAgent: input.userAgent,
  }).catch((err) => logger.error({ err, tenant_id: tenantId }, 'memed-activate-audit-failed'))

  return { environment, connected: true }
}

export interface DeactivateMemedInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

/** Desativa a prescrição digital (mantém a linha e o histórico de aceite). */
export async function deactivateMemed(input: DeactivateMemedInput): Promise<{ connected: false }> {
  const { supabase, tenantId } = input
  const { error } = await supabase
    .from('tenant_memed_config')
    .update({ connected: false })
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`deactivateMemed update failed: ${error.message}`)

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'tenant_memed_config',
    entityId: tenantId,
    field: 'memed.deactivate',
    reason: 'admin desativou a prescrição digital',
    ip: input.ip,
    userAgent: input.userAgent,
  }).catch((err) => logger.error({ err, tenant_id: tenantId }, 'memed-deactivate-audit-failed'))

  return { connected: false }
}

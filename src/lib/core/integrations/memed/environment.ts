import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { recordMemedAudit } from './audit'
import { isMemedProductionConfigured } from './credentials'
import {
  MemedNotConnectedError,
  MemedProductionNotConfiguredError,
  MemedTermsRequiredError,
} from './errors'
import type { MemedEnvironment } from './types'

/**
 * Homologação → produção (Feature 026, US5).
 *  - `acceptMemedTerms`: registra o aceite do termo de responsabilidade.
 *  - `setMemedEnvironment`: troca staging↔production; produção exige termo
 *    aceito (validado aqui com mensagem amigável + reforçado pela constraint
 *    `memed_production_requires_terms` da migration 0108).
 */

export interface AcceptTermsInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export async function acceptMemedTerms(
  input: AcceptTermsInput,
): Promise<{ termsAcceptedAt: string }> {
  const { supabase, tenantId } = input
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('tenant_memed_config')
    .update({ terms_accepted_at: now, terms_accepted_by: input.actorUserId } as never)
    .eq('tenant_id', tenantId)
    .select('terms_accepted_at')
    .maybeSingle()
  if (error) throw new Error(`acceptMemedTerms update failed: ${error.message}`)
  if (!data) throw new MemedNotConnectedError()

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'tenant_memed_config',
    entityId: tenantId,
    field: 'memed.terms.accept',
    reason: 'admin aceitou o termo de responsabilidade Memed',
    ip: input.ip,
    userAgent: input.userAgent,
  }).catch((err) => logger.error({ err, tenant_id: tenantId }, 'memed-terms-audit-failed'))

  return { termsAcceptedAt: now }
}

export interface SetEnvironmentInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  environment: MemedEnvironment
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export async function setMemedEnvironment(
  input: SetEnvironmentInput,
): Promise<{ environment: MemedEnvironment }> {
  const { supabase, tenantId, environment } = input

  const { data: row, error: loadErr } = await supabase
    .from('tenant_memed_config')
    .select('terms_accepted_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (loadErr) throw new Error(`setMemedEnvironment load failed: ${loadErr.message}`)
  if (!row) throw new MemedNotConnectedError()

  if (environment === 'production' && !(row as { terms_accepted_at: string | null }).terms_accepted_at) {
    throw new MemedTermsRequiredError()
  }
  if (environment === 'production' && !isMemedProductionConfigured()) {
    throw new MemedProductionNotConfiguredError()
  }

  const { error } = await supabase
    .from('tenant_memed_config')
    .update({ environment } as never)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`setMemedEnvironment update failed: ${error.message}`)

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'tenant_memed_config',
    entityId: tenantId,
    field: 'memed.environment',
    detail: { environment },
    reason: `admin alterou o ambiente Memed para ${environment}`,
    ip: input.ip,
    userAgent: input.userAgent,
  }).catch((err) => logger.error({ err, tenant_id: tenantId }, 'memed-environment-audit-failed'))

  return { environment }
}

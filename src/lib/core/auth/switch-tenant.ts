import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/observability/errors'
import { setActiveTenant, getActiveTenantId } from './active-tenant'
import { logger } from '@/lib/observability/logger'

/**
 * Feature 010 (US3) — Switch de clínica ativa sem deslogar (R5).
 *
 * Recebe um service-role client porque escreve em user_metadata via
 * `auth.admin.updateUserById` (privilegiado) e em `user_active_tenant`
 * (sem policy de INSERT/UPDATE para authenticated).
 *
 * Pipeline:
 *   1. Validar UUID do tenantId.
 *   2. Verificar vínculo ATIVO em user_tenants.
 *   3. Verificar que o tenant em si está ativo (status='active').
 *   4. updateUserById com user_metadata.active_tenant_id (preservando
 *      full_name e demais metadata).
 *   5. UPSERT em user_active_tenant (memória cross-device).
 *   6. Audit em audit_log com previous → new.
 *
 * Cliente DEVE chamar `supabase.auth.refreshSession()` após o 200 — só
 * assim o auth_hook re-emite o JWT com o novo claim. Não chamar = JWT
 * antigo continua circulando.
 */

export interface SwitchTenantInput {
  userId: string
  tenantId: string
  userEmail: string | null
  ip?: string | null
  userAgent?: string | null
}

export interface SwitchTenantResult {
  previousTenantId: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function switchActiveTenant(
  supabaseService: SupabaseClient<Database>,
  input: SwitchTenantInput,
): Promise<SwitchTenantResult> {
  if (!input.tenantId || !UUID_RE.test(input.tenantId)) {
    throw new ValidationError('invalid_tenant_id', { field: 'tenantId' })
  }

  const { data: link, error: linkErr } = await supabaseService
    .from('user_tenants')
    .select('user_id, tenant_id, role, status')
    .eq('user_id', input.userId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (linkErr && linkErr.code !== 'PGRST116') {
    throw new Error(`switchActiveTenant link query failed: ${linkErr.message}`)
  }
  const isActiveMember = Boolean(link) && (link as { status: string }).status === 'active'

  // Feature 031 — Admin-Agência assume clínica sem vínculo (o auth_hook concede
  // role='admin'). Super entra em qualquer; suporte só nas clínicas atribuídas
  // (platform_admin_tenants). Sem direito ⇒ bloqueia.
  let crossTenant = false
  if (!isActiveMember) {
    // is_super/platform_admin_tenants vêm da 0119 (tipos regenerados depois) — cast.
    const svc: any = supabaseService
    const { data: pa } = await svc
      .from('platform_admins')
      .select('user_id, is_super')
      .eq('user_id', input.userId)
      .maybeSingle()
    if (!pa) {
      throw new ForbiddenError('not_a_member')
    }
    if (!(pa as { is_super: boolean }).is_super) {
      const { data: assigned } = await svc
        .from('platform_admin_tenants')
        .select('tenant_id')
        .eq('user_id', input.userId)
        .eq('tenant_id', input.tenantId)
        .maybeSingle()
      if (!assigned) {
        throw new ForbiddenError('not_assigned_to_tenant')
      }
    }
    crossTenant = true
  }

  const { data: tenantRow, error: tenantErr } = await supabaseService
    .from('tenants')
    .select('id, status')
    .eq('id', input.tenantId)
    .maybeSingle()
  if (tenantErr && tenantErr.code !== 'PGRST116') {
    throw new Error(`switchActiveTenant tenant query failed: ${tenantErr.message}`)
  }
  if (!tenantRow || tenantRow.status !== 'active') {
    throw new NotFoundError('tenant_not_found_or_disabled', input.tenantId)
  }

  const previousTenantId = await getActiveTenantId(supabaseService, input.userId)

  const { data: existingUser } = await supabaseService.auth.admin.getUserById(input.userId)
  const existingMetadata = existingUser?.user?.user_metadata ?? {}
  const { error: metaErr } = await supabaseService.auth.admin.updateUserById(input.userId, {
    user_metadata: {
      ...existingMetadata,
      active_tenant_id: input.tenantId,
    },
  })
  if (metaErr) {
    throw new ConflictError('switch_failed', `Falha ao atualizar metadata: ${metaErr.message}`)
  }

  await setActiveTenant(supabaseService, input.userId, input.tenantId)

  // Audit append-only.
  const { error: auditErr } = await supabaseService.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.userId,
    actor_label: input.userEmail ? `user:${input.userEmail}` : `user:${input.userId}`,
    entity: 'session',
    entity_id: input.userId,
    field: 'tenant_switch',
    old_value: previousTenantId ? JSON.stringify({ tenant_id: previousTenantId }) : null,
    new_value: JSON.stringify({ tenant_id: input.tenantId }),
    reason: crossTenant
      ? 'platform-admin cross-tenant (Admin-Agência)'
      : 'switch via /api/auth/switch-tenant',
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    result: 'success',
  })
  if (auditErr) {
    logger.error(
      { err: auditErr.message, user_id: input.userId, tenant_id: input.tenantId },
      'switch-tenant-audit-failed',
    )
  }

  return { previousTenantId }
}

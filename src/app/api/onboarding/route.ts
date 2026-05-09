import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { UnauthorizedError, ConflictError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import { getAvailableTenants } from '@/lib/auth/available-tenants'
import { createFirstTenant } from '@/lib/core/auth/onboarding'
import { logger } from '@/lib/observability/logger'
import type { Database } from '@/lib/db/types'

/**
 * Feature 010 (US2) — POST /api/onboarding
 *
 * Cria a primeira clínica para um usuário autenticado SEM tenant ativo
 * (FR-014). Pipeline:
 *
 *   1. Verifica autenticação. NÃO usa requireRole — o caller justamente
 *      ainda não tem tenant_id no JWT, então requireRole(any) iria
 *      falhar com 401 indevidamente (jwt_role/jwt_tenant_id ainda
 *      vazios). Aceitamos qualquer auth user válido.
 *   2. Bloqueia se já tem ≥1 vínculo ativo (FR-016 inverso).
 *   3. Chama RPC create_first_tenant via RLS-bound client (RLS valida
 *      auth.uid() = p_user_id na própria função).
 *   4. Atualiza user_metadata.active_tenant_id via service-role para o
 *      auth_hook resolver tenant_id no próximo refreshSession.
 *   5. Audit em audit_log.
 *
 * Cliente após 201: supabase.auth.refreshSession() + redirect ao
 * /operacao/atendimentos.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  try {
    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData.user) {
      throw new UnauthorizedError('Not authenticated')
    }
    const userId = userData.user.id
    const userEmail = userData.user.email ?? null

    const supabaseService = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

    // Bloqueia se já tem tenant ativo.
    const existing = await getAvailableTenants(supabaseService, userId)
    if (existing.length > 0) {
      throw new ConflictError(
        'already_has_tenant',
        'Você já está vinculado a uma clínica. Use o seletor para trocar.',
      )
    }

    const body = await req.json().catch(() => ({}))

    // RPC chamada pelo client RLS-bound (auth.uid() é o caller real).
    const result = await createFirstTenant(supabase, userId, body)

    // Update user_metadata.active_tenant_id para o auth_hook pegar.
    const { error: metaErr } = await supabaseService.auth.admin.updateUserById(userId, {
      user_metadata: {
        full_name: userData.user.user_metadata?.full_name,
        active_tenant_id: result.tenantId,
      },
    })
    if (metaErr) {
      logger.error(
        { err: metaErr.message, user_id: userId, tenant_id: result.tenantId },
        'onboarding-update-metadata-failed',
      )
      // Não rollback — o auth_hook ainda resolve via user_active_tenant
      // (gravado pela RPC). Apenas o "hint" via user_metadata fica vazio.
    }

    // Audit.
    await supabaseService
      .from('audit_log')
      .insert({
        tenant_id: result.tenantId,
        actor_id: userId,
        actor_label: userEmail ? `user:${userEmail}` : `user:${userId}`,
        entity: 'tenants',
        entity_id: result.tenantId,
        field: 'create',
        old_value: null,
        new_value: JSON.stringify({ name: result.name, slug: result.slug }),
        reason: 'onboarding via /api/onboarding',
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        user_agent: req.headers.get('user-agent'),
        result: 'success',
      })
      .then(({ error }) => {
        if (error) {
          logger.error(
            { err: error.message, tenant_id: result.tenantId },
            'onboarding-audit-failed',
          )
        }
      })

    return NextResponse.json(
      { tenantId: result.tenantId, slug: result.slug, name: result.name },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: 'POST /api/onboarding' })
  }
}

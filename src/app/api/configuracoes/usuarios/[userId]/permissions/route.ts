import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getUserOverrides } from '@/lib/auth/overrides'
import { ALL_ACTIONS, type Action } from '@/lib/auth/rbac'
import { setUserPermissionOverrides, type OverrideChange } from '@/lib/core/team/permission-overrides/set'
import { ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 043 — overrides de permissão por usuário (admin da clínica).
 *   GET  → papel do alvo + overrides atuais (a UI computa o efetivo).
 *   POST → aplica mudanças (grant/deny/inherit); rejeita ações protegidas; audita.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/configuracoes/usuarios/[userId]/permissions'
const ACTION_SET = new Set<string>(ALL_ACTIONS as readonly string[])

const bodySchema = z.object({
  changes: z
    .array(
      z.object({
        action: z.string(),
        effect: z.enum(['grant', 'deny', 'inherit']),
      }),
    )
    .min(1),
  reason: z.string().trim().max(500).optional(),
})

export async function GET(
  req: Request,
  { params }: { params: { userId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], { entity: 'user_permission_overrides', route: ROUTE, request: req })
    const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

    const roleRes = await sb
      .from('user_tenants')
      .select('role')
      .eq('tenant_id', session.tenantId)
      .eq('user_id', params.userId)
      .maybeSingle()
    const targetRole = (roleRes.data as { role?: string } | null)?.role ?? null

    const overrides = await getUserOverrides(sb, session.tenantId, params.userId)
    return NextResponse.json({ role: targetRole, overrides })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { userId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], { entity: 'user_permission_overrides', route: ROUTE, request: req })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'payload inválido' } },
        { status: 400 },
      )
    }

    // Só ações conhecidas.
    const changes: OverrideChange[] = parsed.data.changes
      .filter((c) => ACTION_SET.has(c.action))
      .map((c) => ({ action: c.action as Action, effect: c.effect }))
    if (changes.length === 0) {
      return NextResponse.json({ error: { code: 'NO_VALID_ACTIONS', message: 'Nenhuma ação válida.' } }, { status: 400 })
    }

    const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
    try {
      const result = await setUserPermissionOverrides(sb, {
        tenantId: session.tenantId,
        targetUserId: params.userId,
        actorUserId: session.userId,
        actorLabel: session.email ? `user:${session.email}` : null,
        changes,
        reason: parsed.data.reason,
      })
      return NextResponse.json({ applied: result.applied })
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json({ error: { code: 'PROTECTED_ACTION', message: err.message } }, { status: 400 })
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

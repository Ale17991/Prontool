import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { anonymizePatient } from '@/lib/core/patients/anonymize'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import { logger } from '@/lib/observability/logger'

/**
 * T172 — Platform-operator-only anonymization endpoint, separate from
 * the tenant-admin one at /api/pacientes/{id}/anonymize. Used by the
 * LGPD retention sweep that runs out-of-band: there is no tenant
 * session, so the caller authenticates via X-Platform-Operator-Token
 * (constant-time compared against env PLATFORM_OPERATOR_TOKEN).
 *
 * Sits under /api/platform/, which middleware.ts treats as public —
 * the token check below is the *only* gate on this route, so it has
 * to be airtight.
 *
 * Audit row records `actor_label='platform-operator'` and a
 * fixed reason of `lgpd-retention-anonymization` (T171, FR-010c).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
})

const FIXED_REASON = 'lgpd-retention-anonymization'

function tokensEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const expected = process.env.PLATFORM_OPERATOR_TOKEN
    if (!expected || expected.length < 32) {
      logger.error('PLATFORM_OPERATOR_TOKEN missing or too short for safe comparison')
      return NextResponse.json(
        { error: { code: 'PLATFORM_TOKEN_NOT_CONFIGURED' } },
        { status: 503 },
      )
    }
    const provided = req.headers.get('x-platform-operator-token') ?? ''
    if (!provided || !tokensEqual(provided, expected)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Platform operator token mismatch' } },
        { status: 403 },
      )
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'tenant_id (uuid) é obrigatório' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    try {
      const result = await anonymizePatient(supabase, {
        tenantId: parsed.data.tenant_id,
        patientId: params.id,
        actorUserId: null,
        actorLabel: 'platform-operator',
        reason: FIXED_REASON,
      })
      return NextResponse.json(result, { status: 200 })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 404 },
        )
      }
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: `/api/platform/patients/${params.id}/anonymize` })
  }
}

/**
 * Feature 017 — POST /api/public/booking/cancel/[token]
 *
 * Rota PÚBLICA (sem auth). Cancela appointment via token raw.
 * Rate limit 5/h por IP+action='cancel' (a chave de rate limit usa o
 * tenant resolvido pelo próprio token).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { cancelByToken } from '@/lib/core/public-booking/cancel-booking'
import { hashIpForTenant } from '@/lib/core/public-booking/ip-hash'
import {
  bumpRateLimit,
  checkRateLimit,
  RATE_LIMITS,
} from '@/lib/core/public-booking/rate-limit'
import { hashToken } from '@/lib/core/public-booking/tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TokenSchema = z.string().min(20).max(2048)

function extractIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export async function POST(
  request: NextRequest,
  context: { params: { token: string } },
) {
  const tokenCheck = TokenSchema.safeParse(context.params.token)
  if (!tokenCheck.success) {
    return NextResponse.json({ error: 'TOKEN_NOT_VALID' }, { status: 410 })
  }

  const supabase = createSupabaseServiceClient()

  // Pré-resolver tenant via hash do token (precisamos do tenantId para rate-limit).
  const tokenHash = hashToken(tokenCheck.data)
  const { data: tokenRow } = await supabase
    .from('public_booking_tokens')
    .select('tenant_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!tokenRow) {
    return NextResponse.json({ error: 'TOKEN_NOT_VALID' }, { status: 410 })
  }
  const tenantId = tokenRow.tenant_id as string

  const ip = extractIp(request)
  // O ipHash usa o tenantId no lugar do slug aqui (já estamos pós-resolve).
  const ipHash = hashIpForTenant(ip, tenantId)

  const cfg = RATE_LIMITS.cancel
  const rate = await checkRateLimit({
    supabase,
    tenantId,
    ipHash,
    action: 'cancel',
    limit: cfg.limit,
    windowSeconds: cfg.windowSeconds,
  })
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfter: rate.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    )
  }
  await bumpRateLimit({ supabase, tenantId, ipHash, action: 'cancel' })

  const result = await cancelByToken(supabase, {
    rawToken: tokenCheck.data,
    ipHash,
  })

  if (!result.ok) {
    switch (result.error) {
      case 'TOKEN_NOT_VALID':
      case 'TOKEN_EXPIRED':
      case 'TOKEN_ALREADY_USED':
        return NextResponse.json({ error: result.error }, { status: 410 })
      case 'CANCEL_WINDOW_EXPIRED':
        return NextResponse.json(
          {
            error: result.error,
            message: result.message,
            clinicPhone: result.clinicPhone,
            clinicEmail: result.clinicEmail,
          },
          { status: 422 },
        )
      default:
        return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
    }
  }

  return NextResponse.json(result.data, { status: 200 })
}

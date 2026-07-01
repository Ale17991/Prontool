/**
 * Feature 017 — GET /api/public/booking/[slug]/slots
 *
 * Rota PÚBLICA (sem auth). Rate-limit 10/min por IP+tenant+action='view_slots'.
 * Retorna lista de slots disponíveis para uma combinação
 * slug+médico+procedimento dentro de uma janela.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import {
  listAnyDoctorSlots,
  listPublicBookingSlots,
} from '@/lib/core/public-booking/list-slots'
import { listDoctorsForProcedure } from '@/lib/core/public-booking/list-published'
import { hashIpForTenant } from '@/lib/core/public-booking/ip-hash'
import {
  checkRateLimit,
  bumpRateLimit,
  RATE_LIMITS,
} from '@/lib/core/public-booking/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QuerySchema = z.object({
  // 'any' = modo "sem preferencia" — backend une slots de todos os medicos
  // que oferecem o procedimento.
  doctor_id: z.union([z.string().uuid(), z.literal('any')]),
  procedure_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/)

function extractIp(request: NextRequest): string {
  // Fontes CONFIÁVEIS apenas. NUNCA o x-forwarded-for mais à esquerda
  // (controlado pelo cliente): isso permitiria forjar um bucket de rate-limit
  // por request e envenenar o ip_hash gravado no audit_log. Na Vercel o
  // request.ip / x-vercel-forwarded-for (setado pela edge) são autoritativos.
  if (request.ip) return request.ip
  const vercel = request.headers.get('x-vercel-forwarded-for')
  if (vercel) return vercel.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export async function GET(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  const slugCheck = SlugSchema.safeParse(context.params.slug)
  if (!slugCheck.success) {
    return NextResponse.json(
      { error: 'TENANT_NOT_FOUND_OR_DISABLED' },
      { status: 404 },
    )
  }

  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    doctor_id: url.searchParams.get('doctor_id'),
    procedure_id: url.searchParams.get('procedure_id'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  })
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'INVALID_PARAMS',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const supabase = createSupabaseServiceClient()

  const tenant = await resolveTenantBySlug(supabase, slugCheck.data)
  if (!tenant) {
    return NextResponse.json(
      { error: 'TENANT_NOT_FOUND_OR_DISABLED' },
      { status: 404 },
    )
  }

  // Rate limit: 10/min por IP+tenant para action='view_slots'.
  const ip = extractIp(request)
  const ipHash = hashIpForTenant(ip, slugCheck.data)
  const cfg = RATE_LIMITS.view_slots
  const rate = await checkRateLimit({
    supabase,
    tenantId: tenant.tenantId,
    ipHash,
    action: 'view_slots',
    limit: cfg.limit,
    windowSeconds: cfg.windowSeconds,
  })
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfter: rate.retryAfterSec },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSec) },
      },
    )
  }
  await bumpRateLimit({
    supabase,
    tenantId: tenant.tenantId,
    ipHash,
    action: 'view_slots',
  })

  const slots =
    parsed.data.doctor_id === 'any'
      ? await listAnyDoctorSlots(supabase, {
          slug: slugCheck.data,
          doctorIds: await listDoctorsForProcedure(
            supabase,
            tenant.tenantId,
            parsed.data.procedure_id,
          ),
          procedureId: parsed.data.procedure_id,
          from: parsed.data.from,
          to: parsed.data.to,
        })
      : await listPublicBookingSlots(supabase, {
          slug: slugCheck.data,
          doctorId: parsed.data.doctor_id,
          procedureId: parsed.data.procedure_id,
          from: parsed.data.from,
          to: parsed.data.to,
        })

  return NextResponse.json({
    slots,
    timezone: 'America/Sao_Paulo',
  })
}

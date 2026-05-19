/**
 * Feature 017 — GET /api/public/booking/[slug]/slots
 *
 * Rota PÚBLICA (sem auth). Retorna lista de slots disponíveis para uma
 * combinação slug+médico+procedimento dentro de uma janela.
 *
 * Sem Turnstile/rate-limit ainda — entra na US3 (Phase 5).
 *
 * Resposta: { slots: SlotDTO[], timezone }
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { listPublicBookingSlots } from '@/lib/core/public-booking/list-slots'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QuerySchema = z.object({
  doctor_id: z.string().uuid(),
  procedure_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/)

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

  const slots = await listPublicBookingSlots(supabase, {
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

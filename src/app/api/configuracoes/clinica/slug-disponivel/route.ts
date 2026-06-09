import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { isBookingSlugTaken, normalizeBookingSlug } from '@/lib/core/clinic-profile/booking-slug'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/configuracoes/clinica/slug-disponivel?slug=<slug>
 * Checagem em tempo real (onBlur) do slug do portal público (admin).
 * Resposta: { available: boolean, reason?: string }.
 * Slug vazio é "disponível" (significa desativar o portal).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/configuracoes/clinica/slug-disponivel'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: ROUTE,
      request: req,
    })
    const raw = new URL(req.url).searchParams.get('slug')
    const check = normalizeBookingSlug(raw)
    if (!check.ok) {
      return NextResponse.json({ available: false, reason: check.reason })
    }
    if (check.slug === null) {
      // Vazio = portal desativado; sempre "disponível".
      return NextResponse.json({ available: true })
    }
    const supabase = createSupabaseServiceClient()
    const taken = await isBookingSlugTaken(supabase, check.slug, session.tenantId)
    return taken
      ? NextResponse.json({
          available: false,
          reason: 'Este link já está em uso por outra clínica. Escolha outro.',
        })
      : NextResponse.json({ available: true })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

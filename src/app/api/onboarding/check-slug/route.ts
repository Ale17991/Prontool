import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { isValidSlug, nextAvailableSlug } from '@/lib/core/auth/slug'
import { UnauthorizedError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import type { Database } from '@/lib/db/types'

/**
 * Feature 010 (US2) — GET /api/onboarding/check-slug?slug=foo
 *
 * Disponibilidade do slug em tempo real para o form de onboarding (FR-015).
 * Aberto a qualquer usuário autenticado (mesmo sem tenant), por isso
 * AUTH_EXEMPT junto com o restante de /onboarding/*.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      throw new UnauthorizedError('Not authenticated')
    }

    const url = new URL(req.url)
    const slug = url.searchParams.get('slug')?.trim().toLowerCase() ?? ''
    if (!slug) {
      throw new ValidationError('slug é obrigatório', { field: 'slug' })
    }
    if (!isValidSlug(slug)) {
      throw new ValidationError(
        'invalid_slug — use apenas a-z, 0-9 e hífen (3 a 60 chars)',
        { field: 'slug' },
      )
    }

    // Busca direta primeiro pra distinguir disponível vs. tomado.
    const { data: hit, error } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (error && error.code !== 'PGRST116') {
      throw new Error(`check-slug query failed: ${error.message}`)
    }
    if (!hit) {
      return NextResponse.json({ slug, available: true, suggested: null })
    }
    const suggested = await nextAvailableSlug(supabase, slug)
    return NextResponse.json({ slug, available: false, suggested })
  } catch (err) {
    return toHttpResponse(err, { route: 'GET /api/onboarding/check-slug' })
  }
}

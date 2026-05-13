import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 012 — US3 — lista doctors do tenant ainda não vinculados a um login.
 * Admin-only. Usado pelo dialog de cadastro manual.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'doctors',
      route: '/api/configuracoes/usuarios/doctors-disponiveis',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('doctors')
      .select('id, full_name')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .is('user_id', null)
      .order('full_name', { ascending: true })
    if (error) {
      return NextResponse.json(
        { error: { code: 'INTERNAL', message: error.message } },
        { status: 500 },
      )
    }
    return NextResponse.json(
      (data ?? []).map((d) => ({ id: d.id, full_name: d.full_name })),
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, {
      route: '/api/configuracoes/usuarios/doctors-disponiveis',
    })
  }
}

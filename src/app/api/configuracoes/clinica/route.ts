import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { updateClinicProfile } from '@/lib/core/clinic-profile/update'

/**
 * Feature 009 — `/api/configuracoes/clinica`
 *
 *   GET → perfil atual da clínica do tenant ativo. Cria a row vazia
 *         (lazy) na primeira leitura.
 *   PUT → atualiza campos seletivos. Cada campo alterado vira uma linha
 *         de audit_log (Constituição §II).
 *
 * Admin-only em ambos. RLS no banco já garante o isolamento de tenant,
 * mas usamos service-role para que a leitura seja determinística mesmo
 * antes do row existir.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clientContext(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: '/api/configuracoes/clinica',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const profile = await getClinicProfile(supabase, session.tenantId)
    return NextResponse.json(profile)
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/clinica', method: 'GET' })
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: '/api/configuracoes/clinica',
      request: req,
    })
    const body = (await req.json()) as unknown
    const supabase = createSupabaseServiceClient()
    const { ip, userAgent } = clientContext(req)
    const profile = await updateClinicProfile(supabase, session.tenantId, session.userId, body, {
      ip,
      userAgent,
    })
    return NextResponse.json(profile)
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/clinica', method: 'PUT' })
  }
}

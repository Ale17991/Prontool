/**
 * Feature 030 — GET /api/paciente/dados
 *
 * Bundle só-leitura do portal (FR-003/FR-004/FR-006). A identidade
 * (patient_id + tenant_id) vem EXCLUSIVAMENTE do cookie HMAC verificado —
 * nenhum parâmetro do cliente é aceito (invariante do contrato
 * patient-session.md). Sessão ausente/expirada → 401 genérico.
 * Cada consulta gera `view` no access log (FR-020).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { readPatientSessionFromRequest } from '@/lib/core/patient-portal/session'
import { buildPatientPortalBundle } from '@/lib/core/patient-portal/read-portal'
import { hashIpForPatientPortal, logPatientAccess } from '@/lib/core/patient-portal/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function extractIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export async function GET(request: NextRequest): Promise<Response> {
  const session = readPatientSessionFromRequest(request)
  if (!session) {
    return NextResponse.json(
      { error: { code: 'SESSION_INVALID', message: 'Sessão ausente ou expirada.' } },
      { status: 401 },
    )
  }

  const supabase = createSupabaseServiceClient()
  const bundle = await buildPatientPortalBundle(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
  })

  await logPatientAccess({
    supabase,
    tenantId: session.tenantId,
    patientId: session.patientId,
    action: 'view',
    ipHash: hashIpForPatientPortal(extractIp(request), session.tenantId),
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.json(bundle, { status: 200 })
}

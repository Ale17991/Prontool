import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deleteClinicLogo, uploadClinicLogo } from '@/lib/core/clinic-profile/upload-logo'
import { ValidationError } from '@/lib/observability/errors'
import { MAX_LOGO_BYTES } from '@/lib/core/clinic-profile/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clientContext(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: '/api/configuracoes/clinica/logo',
      request: req,
    })

    // Curto-circuito de tamanho — Content-Length declarado.
    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (contentLength > 0 && contentLength > MAX_LOGO_BYTES * 1.05) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Logo excede 2 MB' } },
        { status: 413 },
      )
    }

    const formData = await req.formData()
    const file = formData.get('logo')
    if (!(file instanceof File)) {
      throw new ValidationError('Campo `logo` ausente ou inválido', { reason: 'missing_field' })
    }

    const supabase = createSupabaseServiceClient()
    const { ip, userAgent } = clientContext(req)
    const logo = await uploadClinicLogo(supabase, session.tenantId, session.userId, file, {
      ip,
      userAgent,
    })
    return NextResponse.json({ logo })
  } catch (err) {
    // ValidationError com reason=payload_too_large vira 413; demais ValidationError = 400.
    if (
      err instanceof ValidationError &&
      (err.meta as { reason?: string } | undefined)?.reason === 'payload_too_large'
    ) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: err.message } },
        { status: 413 },
      )
    }
    return toHttpResponse(err, { route: '/api/configuracoes/clinica/logo', method: 'POST' })
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: '/api/configuracoes/clinica/logo',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const { ip, userAgent } = clientContext(req)
    await deleteClinicLogo(supabase, session.tenantId, session.userId, { ip, userAgent })
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/clinica/logo', method: 'DELETE' })
  }
}

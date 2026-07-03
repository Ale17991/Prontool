import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { uploadTissCertificate } from '@/lib/core/tiss/certificates'
import { TissInvalidCertificateError } from '@/lib/core/tiss/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/tiss/certificados → upload do certificado ICP-Brasil A1 (.pfx) + senha
 * (multipart), admin-only. Valida senha/formato, cifra e persiste. Nunca devolve
 * o conteúdo do certificado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/certificados'

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}
function actorLabel(email: string | null, userId: string): string {
  return email ? `user:${email}` : `user:${userId}`
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_tiss_certificates',
      route: ROUTE,
      request: req,
    })

    const form = await req.formData().catch(() => null)
    const file = form?.get('certificate')
    const password = form?.get('password')
    if (!(file instanceof File) || typeof password !== 'string' || password.length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Envie o arquivo .pfx e a senha.' } },
        { status: 400 },
      )
    }
    const pfxBase64 = Buffer.from(await file.arrayBuffer()).toString('base64')

    const supabase = createSupabaseServiceClient()
    const result = await uploadTissCertificate({
      supabase,
      tenantId: session.tenantId,
      pfxBase64,
      password,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof TissInvalidCertificateError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: 400 })
    }
    return toHttpResponse(err, { route: ROUTE })
  }
}

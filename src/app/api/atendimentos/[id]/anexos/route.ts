import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  uploadAppointmentAttachment,
  listAppointmentAttachments,
  MAX_ATTACHMENT_BYTES,
} from '@/lib/core/appointment-attachments'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROLES = ['admin', 'recepcionista', 'profissional_saude'] as const

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/anexos`
  try {
    const session = await requireRole([...ROLES], {
      entity: 'appointment_attachments',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listAppointmentAttachments(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
    })
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/anexos`
  try {
    const session = await requireRole([...ROLES], {
      entity: 'appointment_attachments',
      entityId: params.id,
      route,
      request: req,
    })
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: { code: 'NO_FILE', message: 'Envie um arquivo no campo "file".' } },
        { status: 400 },
      )
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Imagem excede 5 MB.' } },
        { status: 413 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await uploadAppointmentAttachment(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
      actorUserId: session.userId,
      file,
      kind: 'material_label',
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  uploadPatientPhoto,
  deletePatientPhoto,
  MAX_PATIENT_PHOTO_BYTES,
} from '@/lib/core/patients/photo'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/foto`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patients',
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
    if (file.size > MAX_PATIENT_PHOTO_BYTES) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Foto excede 3 MB.' } },
        { status: 413 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await uploadPatientPhoto(
      supabase,
      params.id,
      session.tenantId,
      session.userId,
      file,
    )
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/foto`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patients',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await deletePatientPhoto(supabase, params.id, session.tenantId, session.userId)
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

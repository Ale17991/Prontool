import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  uploadProgressPhoto,
  getProgressSeries,
  MAX_PROGRESS_PHOTO_BYTES,
} from '@/lib/core/patients/progress-photos'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Recepção entra na escrita porque em clínica de estética quem fotografa é
// quem recebe. `financeiro` fica de fora das DUAS: foto de corpo é o dado mais
// sensível da ficha e não tem uso financeiro nenhum.
const PHOTO_ROLES = ['admin', 'recepcionista', 'profissional_saude'] as const

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/fotos-evolucao`
  try {
    const session = await requireRole([...PHOTO_ROLES], {
      entity: 'patients',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const series = await getProgressSeries(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json({ series }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/fotos-evolucao`
  try {
    const session = await requireRole([...PHOTO_ROLES], {
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
    if (file.size > MAX_PROGRESS_PHOTO_BYTES) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Foto excede 8 MB.' } },
        { status: 413 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const photo = await uploadProgressPhoto(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      file,
      angle: form?.get('angle'),
      takenOn: form?.get('takenOn'),
      note: form?.get('note'),
    })
    return NextResponse.json(photo, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { uploadClinicalFile } from '@/lib/core/clinical-records/upload-file'
import { ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/pacientes/{id}/registros/upload — recebe multipart/form-data
 * com `title` (texto) e `file` (binário), faz upload pra Storage e cria
 * o registro com type='arquivo'. Permissão: admin / financeiro /
 * profissional_saude (mesmo set que a rota de texto — profissional pode
 * anexar exames, pedidos, etc.).
 *
 * Body esperado:
 *   - title: string (mín 1, máx 200)
 *   - file:  binário não-vazio, ≤25 MB
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'clinical_records',
      entityId: params.id,
      route: `/api/pacientes/${params.id}/registros/upload`,
      request: req,
    })

    const form = await req.formData().catch(() => null)
    if (!form) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Body deve ser multipart/form-data' } },
        { status: 400 },
      )
    }
    const title = form.get('title')
    const fileEntry = form.get('file') as unknown
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
      throw new ValidationError('title é obrigatório (1..200 caracteres)')
    }
    // Narrow via duck-typing — File/Blob both have `.size` and `.arrayBuffer()`.
    // Avoids a TS quirk where the DOM `File` global isn't always typed in
    // Next.js Route Handler context even though it exists at runtime.
    if (
      !fileEntry ||
      typeof fileEntry !== 'object' ||
      typeof (fileEntry as { size?: unknown }).size !== 'number' ||
      typeof (fileEntry as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
    ) {
      throw new ValidationError('file (binário) é obrigatório')
    }
    const file = fileEntry as Blob & { name?: string }
    const fileName =
      file.name && file.name.length > 0
        ? file.name
        : (form.get('filename') as string | null) ?? 'arquivo.bin'

    const supabase = createSupabaseServiceClient()
    const created = await uploadClinicalFile(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      title,
      file,
      fileName,
      actorUserId: session.userId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, {
      route: `/api/pacientes/${params.id}/registros/upload`,
    })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { registerScan, registerManualEntry, listScans } from '@/lib/core/surgical-scans/scan-service'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postSchema = z.union([
  z.object({ rawBarcode: z.string().trim().min(1).max(500) }),
  z.object({
    manualEntry: z.object({
      lot: z.string().trim().max(60).nullable().optional(),
      expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      manufacturer: z.string().trim().max(120).nullable().optional(),
      description: z.string().trim().max(200).nullable().optional(),
    }),
  }),
])

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/scans`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'surgical_material_scans',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listScans(supabase, session.tenantId, params.id)
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/scans`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'surgical_material_scans',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result =
      'rawBarcode' in parsed.data
        ? await registerScan(supabase, session.tenantId, params.id, parsed.data.rawBarcode, session.userId)
        : await registerManualEntry(supabase, session.tenantId, params.id, parsed.data.manualEntry, session.userId)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

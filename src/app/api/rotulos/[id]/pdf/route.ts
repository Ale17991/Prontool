/**
 * Feature 052 — /api/rotulos/[id]/pdf.
 * Documento do rótulo para a gráfica. Mesmo gate e RBAC das demais rotas.
 */
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getLabel } from '@/lib/core/nutrition/labeling/store'
import { renderNutritionLabelPdf } from '@/lib/core/nutrition/labeling/label-pdf'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/rotulos/${params.id}/pdf`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_labels',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const ent = await getTenantEntitlements(supabase, session.tenantId)
    if (!ent.hasModule('nutri_rotulo')) {
      return NextResponse.json(
        { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
        { status: 404 },
      )
    }

    const loaded = await getLabel(supabase, session.tenantId, params.id)
    if (!loaded) {
      return NextResponse.json(
        { error: { code: 'LABEL_NOT_FOUND', message: 'Rótulo não encontrado.' } },
        { status: 404 },
      )
    }

    const clinicProfile = await getClinicProfile(
      supabase,
      session.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderNutritionLabelPdf({
      clinicProfile,
      label: loaded.label,
      result: loaded.result,
    })

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="rotulo-${params.id}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

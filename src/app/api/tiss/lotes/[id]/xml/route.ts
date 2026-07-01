import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * GET /api/tiss/lotes/[id]/xml → baixa o XML assinado do lote (admin/financeiro).
 * Reproduz exatamente o conteúdo persistido (mesmo hash/assinatura).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/lotes/[id]/xml'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tiss_lotes',
      entityId: params.id,
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('tiss_lotes')
      .select('lote_number, xml_content')
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(`download lote xml: ${error.message}`)
    if (!data || !data.xml_content) throw new NotFoundError('tiss_lote', params.id)

    return new Response(data.xml_content, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'content-disposition': `attachment; filename="lote-${data.lote_number}.xml"`,
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

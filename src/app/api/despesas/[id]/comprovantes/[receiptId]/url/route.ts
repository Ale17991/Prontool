import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * URL assinada (60s) de um comprovante específico.
 * GET /api/despesas/[id]/comprovantes/[receiptId]/url
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'expense-receipts'

export async function GET(
  req: Request,
  { params }: { params: { id: string; receiptId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'expenses',
        entityId: params.id,
        route: `/api/despesas/${params.id}/comprovantes/${params.receiptId}/url`,
        request: req,
      },
    )

    const supabase = createSupabaseServiceClient()
    const lookup = await supabase
      .from('expense_receipts')
      .select('id, storage_path, file_name, content_type, deleted_at')
      .eq('id', params.receiptId)
      .eq('expense_id', params.id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle()
    if (lookup.error) throw new Error(`receipt lookup: ${lookup.error.message}`)
    if (!lookup.data) throw new NotFoundError('expense_receipt', params.receiptId)
    if (lookup.data.deleted_at) {
      throw new NotFoundError('expense_receipt', params.receiptId)
    }

    const signed = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(lookup.data.storage_path, 60)
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(`signed URL failed: ${signed.error?.message}`)
    }

    return NextResponse.json({
      url: signed.data.signedUrl,
      file_name: lookup.data.file_name,
      content_type: lookup.data.content_type,
    })
  } catch (err) {
    return toHttpResponse(err, {
      route: `/api/despesas/${params.id}/comprovantes/${params.receiptId}/url`,
    })
  }
}

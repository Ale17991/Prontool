import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  getExpenseReceiptSignedUrl,
  removeExpenseReceipt,
  uploadExpenseReceipt,
} from '@/lib/core/expenses/upload-receipt'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Comprovante de despesa.
 *
 *   POST   /api/despesas/[id]/comprovante  (multipart) — admin/financeiro
 *   GET    /api/despesas/[id]/comprovante  — qualquer leitor de despesas
 *                                           (retorna URL assinada de 60s)
 *   DELETE /api/despesas/[id]/comprovante  — admin only (remove arquivo)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      entityId: params.id,
      route: `/api/despesas/${params.id}/comprovante`,
      request: req,
    })

    const form = await req.formData().catch(() => null)
    if (!form) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'multipart/form-data esperado' } },
        { status: 400 },
      )
    }
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'campo `file` obrigatorio' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const result = await uploadExpenseReceipt(supabase, {
      tenantId: session.tenantId,
      expenseId: params.id,
      file,
      fileName: file.name,
      contentType: file.type,
      actorUserId: session.userId,
    })

    return NextResponse.json(
      {
        expense_id: result.expenseId,
        file_name: result.fileName,
        file_size: result.fileSize,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}/comprovante` })
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'expenses',
        entityId: params.id,
        route: `/api/despesas/${params.id}/comprovante`,
        request: req,
      },
    )

    const supabase = createSupabaseServiceClient()
    const { url, fileName } = await getExpenseReceiptSignedUrl(supabase, {
      tenantId: session.tenantId,
      expenseId: params.id,
      expiresIn: 60,
    })

    return NextResponse.json({ url, file_name: fileName })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}/comprovante` })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'expenses',
      entityId: params.id,
      route: `/api/despesas/${params.id}/comprovante`,
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    await removeExpenseReceipt(supabase, {
      tenantId: session.tenantId,
      expenseId: params.id,
    })

    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}/comprovante` })
  }
}

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listReceiptsForExpense } from '@/lib/core/expenses/list-receipts'
import { uploadExpenseReceipt } from '@/lib/core/expenses/upload-receipt'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Comprovantes (1:N) de uma despesa.
 *
 *   POST /api/despesas/[id]/comprovantes (multipart, 1+ files) — admin/financeiro
 *   GET  /api/despesas/[id]/comprovantes — qualquer leitor de despesas
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
      route: `/api/despesas/${params.id}/comprovantes`,
      request: req,
    })

    const form = await req.formData().catch(() => null)
    if (!form) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'multipart/form-data esperado' } },
        { status: 400 },
      )
    }

    const files = form
      .getAll('files')
      .filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'campo `files` obrigatorio (1+ arquivos)' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const uploaded: Array<{
      id: string
      file_name: string
      storage_path: string
      file_size_bytes: number
      content_type: string
    }> = []
    const failed: Array<{ file_name: string; error: { code: string; message: string } }> = []

    for (const file of files) {
      try {
        const result = await uploadExpenseReceipt(supabase, {
          tenantId: session.tenantId,
          expenseId: params.id,
          file,
          fileName: file.name,
          contentType: file.type,
          actorUserId: session.userId,
        })
        uploaded.push({
          id: result.receiptId,
          file_name: result.fileName,
          storage_path: result.storagePath,
          file_size_bytes: result.fileSizeBytes,
          content_type: result.contentType,
        })
      } catch (err) {
        failed.push({
          file_name: file.name,
          error: {
            code: (err as { code?: string }).code ?? 'UPLOAD_FAILED',
            message: (err as Error).message ?? 'Falha no upload',
          },
        })
      }
    }

    const allOk = failed.length === 0
    const status = allOk ? 201 : 207
    return NextResponse.json({ uploaded, failed }, { status })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}/comprovantes` })
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
        route: `/api/despesas/${params.id}/comprovantes`,
        request: req,
      },
    )

    const supabase = createSupabaseServiceClient()
    const receipts = await listReceiptsForExpense(supabase, {
      tenantId: session.tenantId,
      expenseId: params.id,
    })

    return NextResponse.json({
      receipts: receipts.map((r) => ({
        id: r.id,
        file_name: r.fileName,
        storage_path: r.storagePath,
        file_size_bytes: r.fileSizeBytes,
        content_type: r.contentType,
        uploaded_at: r.uploadedAt,
        uploaded_by: r.uploadedBy,
      })),
    })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}/comprovantes` })
  }
}

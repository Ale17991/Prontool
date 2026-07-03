import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { softDeleteExpense } from '@/lib/core/expenses/soft-delete'
import { correctExpense } from '@/lib/core/expenses/correct'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * DELETE /api/despesas/{id} — soft-delete (admin only).
 * PUT    /api/despesas/{id} — editar via correção (admin/financeiro).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const putBodySchema = z.object({
  category: z.enum([
    'aluguel',
    'equipamentos',
    'materiais',
    'pessoal',
    'servicos',
    'impostos',
    'manutencao',
    'outros',
  ]),
  description: z.string().trim().min(2).max(500),
  supplier: z.string().trim().max(200).nullable().optional(),
  amount_cents: z.number().int().positive(),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurring: z.boolean(),
  frequency: z.enum(['mensal', 'semanal', 'anual']).nullable().optional(),
})

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      entityId: params.id,
      route: `/api/despesas/${params.id}`,
      request: req,
    })
    const parsed = putBodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await correctExpense(supabase, {
      id: params.id,
      tenantId: session.tenantId,
      actorUserId: session.userId,
      category: parsed.data.category,
      description: parsed.data.description,
      supplier: parsed.data.supplier ?? null,
      amountCents: parsed.data.amount_cents,
      competenceDate: parsed.data.competence_date,
      recurring: parsed.data.recurring,
      frequency: parsed.data.recurring ? (parsed.data.frequency ?? null) : null,
    })
    return NextResponse.json({ id: result.id }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}` })
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
      route: `/api/despesas/${params.id}`,
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    await softDeleteExpense(supabase, {
      id: params.id,
      tenantId: session.tenantId,
      actorUserId: session.userId,
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}` })
  }
}

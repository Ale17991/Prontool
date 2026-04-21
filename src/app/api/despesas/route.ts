import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listExpenses } from '@/lib/core/expenses/list'
import { createExpense } from '@/lib/core/expenses/create'
import { ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/despesas — lista despesas do tenant (admin + financeiro).
 * POST /api/despesas — cria despesa (admin + financeiro). Append-only:
 * o trigger enforce_expenses_mutation garante que mudanças em valor/
 * categoria são bloqueadas após a inserção.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  category: z
    .enum(['aluguel', 'equipamentos', 'materiais', 'pessoal', 'servicos', 'outros', 'all'])
    .optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

const createSchema = z.object({
  category: z.enum(['aluguel', 'equipamentos', 'materiais', 'pessoal', 'servicos', 'outros']),
  description: z.string().min(2).max(500),
  supplier: z.string().max(200).optional().nullable(),
  amount_cents: z.number().int().positive(),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurring: z.boolean().default(false),
  frequency: z.enum(['mensal', 'semanal', 'anual']).optional().nullable(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      route: '/api/despesas',
      request: req,
    })

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const expenses = await listExpenses(supabase, {
      tenantId: session.tenantId,
      category: parsed.data.category,
      startDate: parsed.data.start_date,
      endDate: parsed.data.end_date,
    })
    return NextResponse.json(expenses, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/despesas' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      route: '/api/despesas',
      request: req,
    })

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    try {
      const expense = await createExpense(supabase, {
        tenantId: session.tenantId,
        category: parsed.data.category,
        description: parsed.data.description,
        supplier: parsed.data.supplier,
        amountCents: parsed.data.amount_cents,
        competenceDate: parsed.data.competence_date,
        recurring: parsed.data.recurring,
        frequency: parsed.data.frequency,
        actorUserId: session.userId,
      })
      return NextResponse.json(expense, { status: 201 })
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 400 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/despesas' })
  }
}

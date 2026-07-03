import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createTask } from '@/lib/core/tasks/create'
import { listTasks } from '@/lib/core/tasks/list'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 012 — US1 — GET (lista) + POST (cria) /api/tarefas.
 *
 * GET: 4 papéis. Admin pode filtrar por assignedTo; demais ignorado (RLS força).
 * POST: 4 papéis. Não-admin tem `assigned_to` forçado para `session.userId`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS = ['pendente', 'concluida', 'atrasada', 'todas'] as const
const PRIORITY = ['baixa', 'normal', 'alta', 'urgente'] as const

const querySchema = z.object({
  status: z.enum(STATUS).optional(),
  assigned_to: z.string().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  include_deleted: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
})

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assigned_to: z.string().uuid(),
  priority: z.enum(PRIORITY),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'tasks', route: '/api/tarefas', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    // Para não-admin, ignora assignedTo do query (RLS força ao próprio user).
    // assignedTo 'me' = forçar para self (admin pode usar para filtrar).
    let assignedToFilter: string | undefined
    if (session.role === 'admin') {
      assignedToFilter = parsed.data.assigned_to === 'me' ? session.userId : parsed.data.assigned_to
    } else {
      assignedToFilter = session.userId
    }

    const list = await listTasks(supabase, {
      tenantId: session.tenantId,
      currentUserId: session.userId,
      role: session.role,
      status: parsed.data.status,
      assignedTo: assignedToFilter,
      from: parsed.data.from,
      to: parsed.data.to,
      includeDeleted: parsed.data.include_deleted && session.role === 'admin',
    })
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/tarefas' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'tasks', route: '/api/tarefas', request: req },
    )
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
    // Para não-admin, força `assigned_to = session.userId` (defesa em camadas).
    const assignedTo = session.role === 'admin' ? parsed.data.assigned_to : session.userId

    const supabase = createSupabaseServiceClient()
    try {
      const created = await createTask(supabase, {
        tenantId: session.tenantId,
        title: parsed.data.title,
        notes: parsed.data.notes ?? null,
        dueDate: parsed.data.due_date,
        assignedTo,
        assignedBy: session.userId,
        priority: parsed.data.priority,
      })
      return NextResponse.json(created, { status: 201 })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'USER_NOT_FOUND', message: 'Responsável não pertence à clínica.' } },
          { status: 404 },
        )
      }
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 400 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/tarefas' })
  }
}

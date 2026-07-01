import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateTask } from '@/lib/core/tasks/update-status'
import { softDeleteTask } from '@/lib/core/tasks/soft-delete'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 012 — US1 — PATCH /api/tarefas/{id}.
 *
 * Aceita:
 *  - status / soft_delete: qualquer papel autenticado responsavel (RLS) +
 *    admin para soft_delete. Concluir/reabrir esta liberado para o
 *    responsavel da tarefa (RLS bloqueia outros).
 *  - title / notes / due_date / assigned_to / priority: ADMIN-ONLY.
 *    Defesa em 3 camadas: (1) trigger `enforce_tasks_mutation` bloqueia
 *    authenticated; (2) GRANT explicitamente NAO inclui essas colunas
 *    para authenticated; (3) route handler valida session.role==='admin'
 *    antes de invocar updateTask com esses campos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z
  .object({
    status: z.enum(['pendente', 'concluida']).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    assigned_to: z.string().uuid().optional(),
    priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).optional(),
    soft_delete: z.literal(true).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'pelo menos um campo é obrigatório',
  })

const ADMIN_ONLY_FIELDS = ['title', 'notes', 'due_date', 'assigned_to', 'priority'] as const

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'tasks', entityId: params.id, route: `/api/tarefas/${params.id}`, request: req },
    )
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
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

    // Defesa em camadas: nao-admin nao pode editar campos restritos.
    if (session.role !== 'admin') {
      const usedAdminFields = ADMIN_ONLY_FIELDS.filter((f) => parsed.data[f] !== undefined)
      if (usedAdminFields.length > 0) {
        return NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: `Apenas admin pode editar: ${usedAdminFields.join(', ')}.`,
            },
          },
          { status: 403 },
        )
      }
      if (parsed.data.soft_delete) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Apenas admin pode remover tarefas.' } },
          { status: 403 },
        )
      }
    }

    const supabase = createSupabaseServiceClient()
    try {
      if (parsed.data.soft_delete) {
        await softDeleteTask(supabase, {
          tenantId: session.tenantId,
          id: params.id,
          actorUserId: session.userId,
        })
        return NextResponse.json({ id: params.id, soft_deleted: true }, { status: 200 })
      }

      const updated = await updateTask(supabase, {
        tenantId: session.tenantId,
        id: params.id,
        status: parsed.data.status,
        title: parsed.data.title,
        notes: parsed.data.notes,
        dueDate: parsed.data.due_date,
        assignedTo: parsed.data.assigned_to,
        priority: parsed.data.priority,
        actorUserId: session.userId,
      })
      return NextResponse.json(updated, { status: 200 })
    } catch (err) {
      if (err instanceof NotFoundError) {
        const code = err.message.toLowerCase().includes('user')
          ? 'USER_NOT_FOUND'
          : 'TASK_NOT_FOUND'
        return NextResponse.json({ error: { code, message: err.message } }, { status: 404 })
      }
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 400 },
        )
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: err.message } },
          { status: 403 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: `/api/tarefas/${params.id}` })
  }
}

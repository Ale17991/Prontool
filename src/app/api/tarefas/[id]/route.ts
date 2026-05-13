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
 * Aceita status (concluir/reabrir), notes, priority, soft_delete (admin only).
 * Defesa em camadas: RLS no DB filtra; service layer reforça admin para soft_delete.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z
  .object({
    status: z.enum(['pendente', 'concluida']).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).optional(),
    soft_delete: z.literal(true).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'pelo menos um campo é obrigatório',
  })

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

    const supabase = createSupabaseServiceClient()
    try {
      if (parsed.data.soft_delete) {
        if (session.role !== 'admin') {
          throw new ForbiddenError('Apenas admin pode remover tarefas.')
        }
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
        notes: parsed.data.notes,
        priority: parsed.data.priority,
        actorUserId: session.userId,
      })
      return NextResponse.json(updated, { status: 200 })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'TASK_NOT_FOUND', message: 'Tarefa não encontrada.' } },
          { status: 404 },
        )
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

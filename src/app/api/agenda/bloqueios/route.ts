import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createScheduleBlock } from '@/lib/core/schedule-blocks/create'
import { listScheduleBlocks } from '@/lib/core/schedule-blocks/list'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/agenda/bloqueios?from=YYYY-MM-DD&to=YYYY-MM-DD&doctor_id=uuid
 * Lista bloqueios ativos do tenant. Qualquer papel autenticado.
 *
 * POST /api/agenda/bloqueios
 * Cria um bloqueio. RBAC:
 *   - admin: pode bloquear qualquer profissional
 *   - profissional_saude: so' a propria agenda (doctor_id derivado do
 *     vinculo em doctors.user_id se houver; senao precisa bater com o
 *     doctor_id enviado depois de check explicito)
 *
 * Por simplicidade — alinhado com o resto do app que ainda nao usa
 * doctors.user_id como hard-link (campo introduzido em 0078) — admin e
 * recepcionista podem criar para qualquer doctor; profissional_saude
 * fica de fora. Quando 0078 estiver consolidado, ampliamos o RBAC.
 */

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  doctor_id: z.string().uuid().optional(),
})

const bodySchema = z
  .object({
    doctor_id: z.string().uuid(),
    block_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    all_day: z.boolean(),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .optional()
      .nullable(),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .optional()
      .nullable(),
    reason: z.string().trim().min(2).max(200),
  })
  .superRefine((val, ctx) => {
    if (val.all_day) {
      if (val.start_time || val.end_time) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['start_time'],
          message: 'Bloqueio de dia inteiro não deve ter horários',
        })
      }
    } else {
      if (!val.start_time || !val.end_time) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['start_time'],
          message: 'Horários obrigatórios quando não é dia inteiro',
        })
      } else if (val.end_time <= val.start_time) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['end_time'],
          message: 'Horário de fim deve ser depois do início',
        })
      }
    }
  })

export async function GET(req: Request): Promise<Response> {
  const route = '/api/agenda/bloqueios'
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'schedule_blocks', route, request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Parâmetros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const blocks = await listScheduleBlocks(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from,
      to: parsed.data.to,
      doctorId: parsed.data.doctor_id,
    })
    return NextResponse.json({ blocks }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/agenda/bloqueios'
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'schedule_blocks',
      route,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
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
    const result = await createScheduleBlock(supabase, {
      tenantId: session.tenantId,
      doctorId: parsed.data.doctor_id,
      blockDate: parsed.data.block_date,
      allDay: parsed.data.all_day,
      startTime: parsed.data.start_time ?? null,
      endTime: parsed.data.end_time ?? null,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    })
    return NextResponse.json(
      {
        id: result.id,
        conflicts: result.conflicts,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

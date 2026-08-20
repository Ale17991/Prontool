/**
 * Checklist de hábitos — lado da clínica.
 * GET: grade do paciente + histórico. PUT: monta/ajusta a grade.
 *
 * A equipe MONTA mas não marca: marcar é do paciente (decisão de produto). Por
 * isso não há endpoint de marcação aqui — a coluna `marked_by` existe no banco
 * para o dia em que isso mudar, mas hoje nada a preenche com `equipe`.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getGrid, getHistory, saveChecklist } from '@/lib/core/habits/store'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const itemSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(160),
})

const saveSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(120),
  periodKind: z.enum(['semanal', 'quinzenal', 'mensal']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(itemSchema).min(1).max(30),
  active: z.boolean().optional(),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('habitos')
}
function moduleDisabled(): Response {
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/habitos`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_habit_checklists',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    const t = today()
    const [grid, history] = await Promise.all([
      getGrid(supabase, { tenantId: session.tenantId, patientId: params.id, today: t }),
      getHistory(supabase, { tenantId: session.tenantId, patientId: params.id, today: t }),
    ])
    return NextResponse.json({ grid, history }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/habitos`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_habit_checklists',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const parsed = saveSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const b = parsed.data
    const ids = new Set(b.items.map((i) => i.id))
    if (ids.size !== b.items.length) {
      // Id repetido colidiria com o UNIQUE das marcações e faria dois hábitos
      // compartilharem a mesma marcação.
      return NextResponse.json(
        { error: { code: 'DUPLICATE_ITEM_ID', message: 'Há hábitos com o mesmo identificador.' } },
        { status: 422 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const { id } = await saveChecklist(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      id: b.id ?? null,
      title: b.title,
      periodKind: b.periodKind,
      startDate: b.startDate,
      items: b.items,
      active: b.active,
    })
    const grid = await getGrid(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      today: today(),
    })
    return NextResponse.json({ id, grid }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

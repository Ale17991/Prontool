/**
 * Modelos de checklist de hábitos da clínica — a lista base.
 * GET lista, POST cria/edita, DELETE remove.
 *
 * Aplicar um modelo num paciente é uma CÓPIA (padrão dos grupos alimentares da
 * 047): ajustar o checklist de alguém não pode mexer na lista base, senão o
 * ajuste de um paciente vazaria para todos os outros.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { deleteTemplate, listTemplates, saveTemplate } from '@/lib/core/habits/store'
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

export async function GET(req: Request): Promise<Response> {
  const route = '/api/habitos/modelos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'habit_checklist_templates',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const templates = await listTemplates(createSupabaseServiceClient(), session.tenantId)
    return NextResponse.json({ templates }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/habitos/modelos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'habit_checklist_templates',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const parsed = saveSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const b = parsed.data
    if (new Set(b.items.map((i) => i.id)).size !== b.items.length) {
      return NextResponse.json(
        { error: { code: 'DUPLICATE_ITEM_ID', message: 'Há hábitos com o mesmo identificador.' } },
        { status: 422 },
      )
    }
    const { id } = await saveTemplate(createSupabaseServiceClient(), {
      tenantId: session.tenantId,
      id: b.id ?? null,
      title: b.title,
      items: b.items,
      active: b.active,
    })
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const route = '/api/habitos/modelos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'habit_checklist_templates',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const id = new URL(req.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Informe o id do modelo.' } },
        { status: 400 },
      )
    }
    const ok = await deleteTemplate(createSupabaseServiceClient(), session.tenantId, id)
    if (!ok) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Modelo não encontrado.' } },
        { status: 404 },
      )
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

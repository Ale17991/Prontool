/**
 * Feature 052 — /api/rotulos/[id] (equipe).
 * GET: rótulo + tabela recalculada. PATCH: edita (inclusive sobrescritas
 * manuais). DELETE: remove.
 *
 * O `LabelResult` sai recalculado em toda leitura — nunca vem gravado.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { deleteLabel, getLabel, updateLabel } from '@/lib/core/nutrition/labeling/store'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ingredientSchema = z.object({
  foodId: z.string().uuid(),
  grams: z.number().positive().max(100000),
  position: z.number().int().min(0).optional(),
})

const patchSchema = z.object({
  productName: z.string().trim().min(1).max(200).optional(),
  clientName: z.string().max(200).optional().nullable(),
  basis: z.enum(['solido', 'liquido']).optional(),
  totalYield: z.number().positive().max(1000000).optional(),
  portionSize: z.number().positive().max(1000000).optional(),
  householdMeasure: z.string().max(80).optional().nullable(),
  portionsPerPackage: z.number().positive().max(100000).optional().nullable(),
  ingredientsText: z.string().max(4000).optional().nullable(),
  allergensText: z.string().max(2000).optional().nullable(),
  storageText: z.string().max(2000).optional().nullable(),
  ingredients: z.array(ingredientSchema).min(1).max(80).optional(),
  // Número define a sobrescrita; `null` desfaz e volta ao calculado (FR-013).
  manualValues: z.record(z.number().finite().nonnegative().nullable()).optional(),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('nutri_rotulo')
}
function moduleDisabled(): Response {
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}
function notFound(): Response {
  return NextResponse.json(
    { error: { code: 'LABEL_NOT_FOUND', message: 'Rótulo não encontrado.' } },
    { status: 404 },
  )
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/rotulos/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_labels',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const loaded = await getLabel(createSupabaseServiceClient(), session.tenantId, params.id)
    if (!loaded) return notFound()
    return NextResponse.json(loaded, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/rotulos/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_labels',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const b = parsed.data
    const supabase = createSupabaseServiceClient()

    const current = await getLabel(supabase, session.tenantId, params.id)
    if (!current) return notFound()

    // O PATCH é parcial: a coerência porção ≤ rendimento vale sobre o estado
    // RESULTANTE, não só sobre o que veio no corpo — mudar só a porção pode
    // ultrapassar um rendimento que ficou intocado.
    const nextYield = b.totalYield ?? current.label.totalYield
    const nextPortion = b.portionSize ?? current.label.portionSize
    if (nextPortion > nextYield) {
      return NextResponse.json(
        {
          error: {
            code: 'PORTION_EXCEEDS_YIELD',
            message: 'A porção não pode ser maior que o rendimento total.',
          },
        },
        { status: 422 },
      )
    }

    const updated = await updateLabel(supabase, {
      tenantId: session.tenantId,
      labelId: params.id,
      actorUserId: session.userId,
      ...b,
    })
    if (!updated) return notFound()
    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/rotulos/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_labels',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const ok = await deleteLabel(createSupabaseServiceClient(), session.tenantId, params.id)
    if (!ok) return notFound()
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

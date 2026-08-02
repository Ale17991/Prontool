/**
 * Feature 052 — /api/rotulos (equipe).
 * GET: lista os rótulos da clínica. POST: cria um rótulo.
 *
 * O rótulo é o produto de um CLIENTE da clínica, não de um paciente — por isso
 * a rota fica na raiz e não sob `/api/pacientes/[id]`.
 * Gated `nutri_rotulo`; leitura e escrita admin/profissional_saude.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { createLabel, getLabel, listLabels } from '@/lib/core/nutrition/labeling/store'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ingredientSchema = z.object({
  foodId: z.string().uuid(),
  grams: z.number().positive().max(100000),
  position: z.number().int().min(0).optional(),
})

export const labelFieldsSchema = {
  productName: z.string().trim().min(1).max(200),
  clientName: z.string().max(200).optional().nullable(),
  basis: z.enum(['solido', 'liquido']),
  totalYield: z.number().positive().max(1000000),
  portionSize: z.number().positive().max(1000000),
  householdMeasure: z.string().max(80).optional().nullable(),
  portionsPerPackage: z.number().positive().max(100000).optional().nullable(),
  ingredientsText: z.string().max(4000).optional().nullable(),
  allergensText: z.string().max(2000).optional().nullable(),
  storageText: z.string().max(2000).optional().nullable(),
}

const createSchema = z.object({
  ...labelFieldsSchema,
  ingredients: z.array(ingredientSchema).min(1).max(80),
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

export async function GET(req: Request): Promise<Response> {
  const route = '/api/rotulos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_labels',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const labels = await listLabels(createSupabaseServiceClient(), session.tenantId)
    return NextResponse.json({ labels }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/rotulos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_labels',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const b = parsed.data
    // Porção maior que o rendimento é incoerência de dados, não payload malformado:
    // o preparo inteiro não daria nem uma porção, e todos os valores por porção
    // sairiam maiores que o total.
    if (b.portionSize > b.totalYield) {
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

    const supabase = createSupabaseServiceClient()
    const { id } = await createLabel(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      productName: b.productName,
      clientName: b.clientName ?? null,
      basis: b.basis,
      totalYield: b.totalYield,
      portionSize: b.portionSize,
      householdMeasure: b.householdMeasure ?? null,
      portionsPerPackage: b.portionsPerPackage ?? null,
      ingredientsText: b.ingredientsText ?? null,
      allergensText: b.allergensText ?? null,
      storageText: b.storageText ?? null,
      ingredients: b.ingredients,
    })
    const loaded = await getLabel(supabase, session.tenantId, id)
    return NextResponse.json({ id, result: loaded?.result ?? null }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

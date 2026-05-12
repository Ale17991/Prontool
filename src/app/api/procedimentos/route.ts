import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listProcedures } from '@/lib/core/procedures/list'
import { createProcedure } from '@/lib/core/procedures/create'
import { upsertCustomCode } from '@/lib/core/custom-codes'
import { denyAudit } from '@/lib/core/audit/deny'
import { TussCodeInvalidError, ConflictError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T164 — GET / POST /api/procedimentos. Leitura pra todos os papéis
 * com `procedure.read`; escrita só admin (validação TUSS no trigger
 * da migration 0014 + denyAudit em rejeição).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  include_inactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  only_covered_by_plan: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
})

const createSchema = z
  .object({
    tuss_code: z.string().min(1).nullable().optional(),
    display_name: z.string().nullable().optional(),
    default_amount_cents: z.number().int().nonnegative().nullable().optional(),
    covered_by_plan: z.boolean().optional(),
    is_unlisted: z.boolean().optional(),
    /** Codigo personalizado (texto livre) — quando unlisted=true. Cria
     * registry em custom_procedure_codes ou reusa se ja existir. */
    custom_code: z.string().trim().min(1).max(50).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const unlisted = value.is_unlisted === true
    if (unlisted) {
      if (value.tuss_code !== null && value.tuss_code !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tuss_code'],
          message: 'tuss_code deve ser null quando is_unlisted=true',
        })
      }
      if (!value.display_name || value.display_name.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['display_name'],
          message: 'display_name é obrigatório para procedimento não listado',
        })
      }
    } else {
      if (!value.tuss_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tuss_code'],
          message: 'tuss_code é obrigatório quando is_unlisted=false',
        })
      }
      if (value.custom_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['custom_code'],
          message: 'custom_code só pode ser usado quando is_unlisted=true',
        })
      }
    }
  })

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'procedures', route: '/api/procedimentos', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const list = await listProcedures(supabase, {
      tenantId: session.tenantId,
      includeInactive: parsed.data.include_inactive,
      onlyCoveredByPlan: parsed.data.only_covered_by_plan,
    })
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/procedimentos' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'procedures',
      route: '/api/procedimentos',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      // Quando unlisted + custom_code: cria (ou reusa) o codigo no registry
      // antes de criar o procedimento, e amarra via custom_code_id.
      let customCodeId: string | null = null
      if (parsed.data.is_unlisted && parsed.data.custom_code) {
        const code = await upsertCustomCode(supabase, {
          tenantId: session.tenantId,
          code: parsed.data.custom_code,
          description: parsed.data.display_name?.trim() ?? parsed.data.custom_code,
          actorUserId: session.userId,
        })
        customCodeId = code.id
      }

      const created = await createProcedure(supabase, {
        tenantId: session.tenantId,
        tussCode: parsed.data.tuss_code ?? null,
        displayName: parsed.data.display_name ?? null,
        defaultAmountCents: parsed.data.default_amount_cents ?? null,
        coveredByPlan: parsed.data.covered_by_plan ?? true,
        isUnlisted: parsed.data.is_unlisted ?? false,
        customCodeId,
      })
      return NextResponse.json(
        {
          id: created.id,
          tuss_code: created.tussCode,
          display_name: created.displayName,
          active: created.active,
          created_at: created.createdAt,
          default_amount_cents: created.defaultAmountCents,
          covered_by_plan: created.coveredByPlan,
          is_unlisted: created.isUnlisted,
          custom_code_id: created.customCodeId,
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof TussCodeInvalidError) {
        await denyAudit({
          tenantId: session.tenantId,
          actorId: session.userId,
          actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
          entity: 'procedures',
          reason: `TUSS inválido: ${parsed.data.tuss_code ?? '(null)'}`,
          result: 'denied',
        })
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 400 },
        )
      }
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/procedimentos' })
  }
}

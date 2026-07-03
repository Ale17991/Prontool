import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createAnamnesisTemplate, type AnamnesisField } from '@/lib/core/anamnesis/create-template'
import { ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET  /api/anamnesis-templates — lista todos os templates do tenant
 *                                (todos os papéis com acesso de leitura).
 * POST /api/anamnesis-templates — cria novo template ou nova versão
 *                                (admin apenas). Append-only: editar =
 *                                criar nova linha com version+1.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const fieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['texto_curto', 'texto_longo', 'checkbox', 'radio', 'select', 'data', 'numero']),
  label: z.string().min(1),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  is_default: z.boolean().optional(),
})

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  fields: z.array(fieldSchema).min(1),
  previous_version_id: z.string().uuid().optional().nullable(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'anamnesis_templates', route: '/api/anamnesis-templates', request: req },
    )

    const url = new URL(req.url)
    const includeInactive = url.searchParams.get('include_inactive') === '1'

    const supabase = createSupabaseServiceClient()
    let q = supabase
      .from('anamnesis_templates')
      .select('*')
      .eq('tenant_id', session.tenantId)
      .order('title', { ascending: true })
      .order('version', { ascending: false })
    if (!includeInactive) q = q.eq('active', true)

    const { data, error } = await q
    if (error) throw new Error(`list anamnesis templates: ${error.message}`)
    return NextResponse.json(data ?? [], { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/anamnesis-templates' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'anamnesis_templates',
      route: '/api/anamnesis-templates',
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
      const template = await createAnamnesisTemplate(supabase, {
        tenantId: session.tenantId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        fields: parsed.data.fields as AnamnesisField[],
        actorUserId: session.userId,
        previousVersionId: parsed.data.previous_version_id ?? null,
      })
      return NextResponse.json(template, { status: 201 })
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
    return toHttpResponse(err, { route: '/api/anamnesis-templates' })
  }
}

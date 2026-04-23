import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { searchTussCatalog } from '@/lib/core/catalog/list-tuss'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/tuss-codes?q=&limit= — busca no catálogo TUSS global.
 *
 * Permissão: qualquer papel autenticado (catálogo é leitura pública
 * dentro do contexto autenticado; serve o typeahead da tela de
 * procedimentos). Apenas admin efetivamente usa pra cadastrar, mas
 * deixar a leitura aberta evita ter que duplicar dropdowns por papel.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  q: z.string().optional(),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v))),
  table: z.enum(['22', '19', '20']).optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    await requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'], {
      entity: 'tuss_codes',
      route: '/api/tuss-codes',
      request: req,
    })
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const results = await searchTussCatalog(supabase, {
      query: parsed.data.q,
      limit: parsed.data.limit,
      table: parsed.data.table,
    })
    return NextResponse.json(results, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/tuss-codes' })
  }
}

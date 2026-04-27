import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/cid10?q=<termo> — busca em cid10_codes por código (prefix
 * match) ou descrição (full-text portuguesa). Retorna top 20 resultados
 * com { code, description }. Acessível para qualquer role autenticado
 * (cid10_codes é dado de referência público, sem tenant_id).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  q: z.string().min(1).max(100),
})

interface Cid10Row {
  code: string
  description: string
  chapter: string | null
}

export async function GET(req: Request): Promise<Response> {
  try {
    await requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'], {
      entity: 'cid10_codes',
      route: '/api/cid10',
      request: req,
    })
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'q é obrigatório' } },
        { status: 400 },
      )
    }
    const term = parsed.data.q.trim()
    const supabase = createSupabaseServiceClient()

    // Tenta primeiro como prefix de código (CID começa com letra+dígitos);
    // depois full-text na descrição. Combinamos os dois e dedupe por code.
    const isCodeLike = /^[A-Za-z]\d/.test(term) || /^[A-Za-z]\d{2}/.test(term)

    const codeQuery = isCodeLike
      ? supabase
          .from('cid10_codes')
          .select('code, description, chapter')
          .ilike('code', `${term.toUpperCase()}%`)
          .order('code', { ascending: true })
          .limit(20)
      : null

    const ftQuery = supabase
      .from('cid10_codes')
      .select('code, description, chapter')
      .textSearch('description', term, {
        type: 'plain',
        config: 'portuguese',
      })
      .limit(20)

    const [codeRes, ftRes] = await Promise.all([
      codeQuery ?? Promise.resolve({ data: [], error: null }),
      ftQuery,
    ])
    if (codeRes.error) throw new Error(`cid10 code search: ${codeRes.error.message}`)
    if (ftRes.error) throw new Error(`cid10 ft search: ${ftRes.error.message}`)

    const seen = new Set<string>()
    const merged: Cid10Row[] = []
    for (const row of [...(codeRes.data ?? []), ...(ftRes.data ?? [])] as Cid10Row[]) {
      if (seen.has(row.code)) continue
      seen.add(row.code)
      merged.push(row)
      if (merged.length >= 20) break
    }

    return NextResponse.json({ items: merged }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/cid10' })
  }
}

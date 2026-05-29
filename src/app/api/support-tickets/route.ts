/**
 * POST /api/support-tickets
 *
 * Endpoint autenticado para envio de tickets de bug/sugestao/suporte pelo
 * botao da sidebar. Qualquer role autenticada do tenant pode chamar.
 *
 * Pipeline:
 *   1. getSession (401 se nao autenticado)
 *   2. Zod parse do payload
 *   3. createSupportTicket — insere via RLS (authenticated own tenant)
 *      + dispara email best-effort para operations@homio.com.br
 *   4. 201 com { id, emailDelivered }
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import {
  SupportTicketCreateSchema,
  createSupportTicket,
} from '@/lib/core/support-tickets'
import { logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_PAYLOAD', message: 'JSON malformed' },
      { status: 400 },
    )
  }

  const parsed = SupportTicketCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'INVALID_PAYLOAD',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  // Cast segue padrao de outros route handlers (ver agendamento-publico/page.tsx)
  // — o generico do client SSR diverge em um param do que core libs esperam.
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const userAgent = request.headers.get('user-agent')

  // Resolve nome do tenant para o email (nao bloqueante). Cast manual segue
  // padrao do projeto (ver tenant-tz.ts:41) — `.maybeSingle()` infere data
  // como `never` no client com Database generico.
  let tenantName: string | null = null
  try {
    const { data } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', session.tenantId)
      .maybeSingle()
    tenantName = (data as { name?: string | null } | null)?.name ?? null
  } catch {
    // tenant name é opcional — segue sem.
  }

  try {
    const result = await createSupportTicket(
      supabase,
      {
        tenantId: session.tenantId,
        userId: session.userId,
        userEmail: session.email,
        userRole: session.role,
        tenantName,
        userAgent,
      },
      parsed.data,
    )
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      {
        err: message,
        tenant_id: session.tenantId,
        user_id: session.userId,
      },
      'support-tickets-create-failed',
    )
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message },
      { status: 500 },
    )
  }
}

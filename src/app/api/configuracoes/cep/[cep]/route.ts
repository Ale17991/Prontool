import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 009 — proxy `/api/configuracoes/cep/{cep}` para ViaCEP.
 *
 * - Auth: qualquer role autenticado (consultar CEP é leitura pública).
 * - Timeout: 3 s (research.md R3); o front degrada graciosamente quando
 *   `ok: false`.
 * - Cache: 24 h via header (`s-maxage=86400`) — stale-while-revalidate 7d.
 *
 * NUNCA retorna 5xx para falhas de upstream — sempre 200 com `ok: false`,
 * para o form não bloquear o salvamento (FR-007).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ViaCepRaw {
  cep?: string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean
}

export async function GET(
  req: Request,
  { params }: { params: { cep: string } },
): Promise<Response> {
  const route = '/api/configuracoes/cep/:cep'
  try {
    await requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'], {
      entity: 'cep',
      route,
      request: req,
    })

    const cep = (params.cep ?? '').replace(/\D+/g, '')
    if (!/^[0-9]{8}$/.test(cep)) {
      return NextResponse.json(
        { error: { code: 'INVALID_CEP', message: 'CEP deve ter 8 dígitos' } },
        { status: 400 },
      )
    }

    let raw: ViaCepRaw | null = null
    let reason: 'not_found' | 'timeout' | 'unavailable' | null = null

    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        reason = 'unavailable'
      } else {
        raw = (await res.json()) as ViaCepRaw
        if (raw?.erro === true) {
          reason = 'not_found'
          raw = null
        }
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      reason = name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'unavailable'
    }

    if (!raw) {
      return NextResponse.json(
        { ok: false, reason: reason ?? 'unavailable' },
        {
          status: 200,
          headers: {
            // Cache curto para falhas — não bloqueia retry rápido.
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          },
        },
      )
    }

    return NextResponse.json(
      {
        ok: true,
        address: {
          cep: (raw.cep ?? cep).replace(/\D+/g, ''),
          street: (raw.logradouro ?? '').trim() || null,
          neighborhood: (raw.bairro ?? '').trim() || null,
          city: (raw.localidade ?? '').trim() || null,
          uf: (raw.uf ?? '').trim().toUpperCase() || null,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      },
    )
  } catch (err) {
    return toHttpResponse(err, { route, method: 'GET' })
  }
}

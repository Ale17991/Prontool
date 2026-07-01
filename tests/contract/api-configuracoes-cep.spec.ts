/**
 * Feature 009 (US1) — contract test for `/api/configuracoes/cep/:cep`.
 *
 * Cobre: 400 para CEP malformado, 200+ok:false para CEP não encontrado e
 * timeout, 200+ok:true para sucesso, e que o cache header sai certo. Sem
 * dependência de DB — autentica via mintJwt + intercepta `fetch` global.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'

describe('contract: GET /api/configuracoes/cep/:cep', () => {
  let jwt: string
  beforeAll(async () => {
    await resetDatabase()
    const { tenantId } = await seedTenant('cep-contract')
    const u = await seedUser(tenantId, 'admin')
    jwt = mintJwt({ userId: u.userId, email: u.email, tenantId, role: 'admin' })
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function callRoute(cep: string): Promise<Response> {
    const { GET } = await import('@/app/api/configuracoes/cep/[cep]/route')
    return GET(
      new Request(`http://localhost/api/configuracoes/cep/${cep}`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { cep } },
    )
  }

  it('400 quando CEP não tem 8 dígitos', async () => {
    const res = await callRoute('1234')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_CEP')
  })

  it('200 + ok:true mapeia campos do ViaCEP para o shape interno', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cep: '01310-100',
          logradouro: 'Avenida Paulista',
          bairro: 'Bela Vista',
          localidade: 'São Paulo',
          uf: 'sp',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const res = await callRoute('01310100')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://viacep.com.br/ws/01310100/json/',
      expect.any(Object),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400')
    const body = (await res.json()) as { ok: boolean; address: Record<string, string | null> }
    expect(body.ok).toBe(true)
    expect(body.address).toEqual({
      cep: '01310100',
      street: 'Avenida Paulista',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      uf: 'SP',
    })
  })

  it('200 + ok:false quando ViaCEP retorna { erro: true }', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ erro: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = await callRoute('99999999')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; reason: string }
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('not_found')
  })

  it('200 + ok:false (timeout) quando o fetch é abortado', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    )
    const res = await callRoute('01310100')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; reason: string }
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('timeout')
  })

  it('200 + ok:false (unavailable) quando upstream retorna não-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('Internal', { status: 500 }))
    const res = await callRoute('01310100')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; reason: string }
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('unavailable')
  })
})

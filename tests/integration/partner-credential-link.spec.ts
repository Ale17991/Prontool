/**
 * Entrega da credencial de parceiro por link de uso único (0215 + 0217).
 *
 * Este teste existe por causa de um defeito real: o CHECK
 * `partner_credential_links_burned` proíbe linha revelada que ainda carregue o
 * segredo, e a primeira versão do código criava exatamente esse estado — marcava
 * `revealed_at` para reservar a linha, lia o segredo, e só depois apagava.
 * Todo revelar quebrava com `23514`, e o parceiro via uma tela de erro genérica.
 *
 * `tsc`, `next lint` e `next build` passavam limpos: a regra só existe no banco.
 * Por isso a cobertura tem que ser de INTEGRAÇÃO — é o schema real que reprova.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import type { Database } from '@/lib/db/types'
import {
  createCredentialLink,
  peekCredentialLink,
  revealCredentialLink,
} from '@/lib/core/partners/credential-link'

describe('link de credencial de parceiro', () => {
  const sb = serviceClient() as unknown as SupabaseClient<Database>
  let partnerId: string
  // `created_by` das duas tabelas referencia auth.users — um uuid inventado
  // esbarraria na FK e o teste falharia por motivo errado.
  let actorId: string

  beforeAll(async () => {
    await resetDatabase()
    const tenant = await seedTenant()
    actorId = (await seedUser(tenant.tenantId, 'admin')).userId
    const { data, error } = await serviceClient()
      .from('billing_partners' as never)
      .insert({ name: 'Parceiro de Teste', slug: 'parceiro-teste' } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed billing_partners: ${error.message}`)
    partnerId = (data as unknown as { id: string }).id
  })

  async function novoLink() {
    return createCredentialLink(sb, actorId, {
      partnerId,
      name: 'produção',
      scopes: ['clinicas:read'],
      baseUrl: 'https://app.exemplo.com.br',
    })
  }

  it('o link nasce válido e nomeia o parceiro, sem revelar nada', async () => {
    const link = await novoLink()
    expect(link.url).toContain('/parceiro/credenciais/')

    const info = await peekCredentialLink(sb, link.token)
    expect(info.status).toBe('valido')
    expect(info.parceiro).toBe('Parceiro de Teste')
  })

  it('revelar devolve a chave e não esbarra no CHECK de linha queimada', async () => {
    const link = await novoLink()

    const res = await revealCredentialLink(sb, link.token, '203.0.113.7')
    expect('secret' in res).toBe(true)
    if (!('secret' in res)) return

    // A chave revelada é a que a API vai aceitar: mesmo prefixo, formato certo.
    expect(res.secret).toMatch(/^clinni_[a-f0-9]{16}_[a-f0-9]{64}$/)
    expect(res.secret).toContain(link.keyPrefix)
  })

  it('o segredo é APAGADO da linha ao revelar — nada recuperável fica parado', async () => {
    const link = await novoLink()
    await revealCredentialLink(sb, link.token, null)

    const { data } = await serviceClient()
      .from('partner_credential_links' as never)
      .select('revealed_at, revealed_ip, secret_enc')
      .eq('api_key_id', link.apiKeyId)
      .single()
    const row = data as unknown as {
      revealed_at: string | null
      secret_enc: string | null
    }
    expect(row.revealed_at).not.toBeNull()
    expect(row.secret_enc).toBeNull()
  })

  it('o segundo revelar não entrega nada — é uso ÚNICO', async () => {
    const link = await novoLink()
    const primeiro = await revealCredentialLink(sb, link.token, null)
    expect('secret' in primeiro).toBe(true)

    const segundo = await revealCredentialLink(sb, link.token, null)
    expect(segundo).toEqual({ erro: 'usado' })

    // E a tela de confirmação passa a dizer o mesmo.
    expect((await peekCredentialLink(sb, link.token)).status).toBe('usado')
  })

  it('revelar em paralelo entrega para UM só — o lock decide, não a sorte', async () => {
    const link = await novoLink()
    const [a, b] = await Promise.all([
      revealCredentialLink(sb, link.token, null),
      revealCredentialLink(sb, link.token, null),
    ])
    const entregues = [a, b].filter((r) => 'secret' in r)
    expect(entregues).toHaveLength(1)
  })

  it('token desconhecido não revela e não vaza que o formato estava certo', async () => {
    const res = await revealCredentialLink(sb, 'f'.repeat(64), null)
    expect(res).toEqual({ erro: 'desconhecido' })
    expect((await peekCredentialLink(sb, 'f'.repeat(64))).status).toBe('desconhecido')
  })

  it('token malformado é recusado antes de qualquer ida ao banco', async () => {
    expect(await revealCredentialLink(sb, 'abc', null)).toEqual({ erro: 'desconhecido' })
  })
})

/**
 * Bug fix follow-up — procedimentos sem display_name agora puxam o nome
 * do catalogo TUSS automaticamente:
 *   1. createProcedure: quando displayName vem vazio + tem tussCode +
 *      nao e unlisted, busca em tuss_codes.description.
 *   2. Migration 0080 fez backfill dos existentes.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedTussCode, seedUser } from '@/tests/helpers/seed-factories'
import { createProcedure } from '@/lib/core/procedures/create'

describe('Bug fix — auto-fill display_name a partir de tuss_codes', () => {
  let tenantId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('proc-autofill')
    tenantId = t.tenantId
    await seedUser(tenantId, 'admin')
    // Cataloga TUSS especifico com description rica
    await seedTussCode('30306027', {
      tussTable: '22',
      description: 'Facectomia com lente intra-ocular',
    })
    await seedTussCode('10101012', {
      tussTable: '22',
      description: 'Consulta em consultório',
    })
  })

  beforeEach(async () => {
    // Limpa procedures entre testes (mas mantem tuss_codes)
    const sb = serviceClient()
    await sb.from('procedures').delete().eq('tenant_id', tenantId)
  })

  it('displayName VAZIO + tussCode existente → puxa do catalogo TUSS', async () => {
    const sb = serviceClient()
    const created = await createProcedure(sb, {
      tenantId,
      tussCode: '30306027',
      // displayName intencionalmente nao informado
    })
    expect(created.displayName).toBe('Facectomia com lente intra-ocular')
  })

  it('displayName em branco (string vazia/trim) tambem puxa do catalogo', async () => {
    const sb = serviceClient()
    const created = await createProcedure(sb, {
      tenantId,
      tussCode: '10101012',
      displayName: '   ', // só whitespace
    })
    expect(created.displayName).toBe('Consulta em consultório')
  })

  it('displayName preenchido manualmente é respeitado (não sobrescreve)', async () => {
    const sb = serviceClient()
    const created = await createProcedure(sb, {
      tenantId,
      tussCode: '30306027',
      displayName: 'Meu nome customizado',
    })
    expect(created.displayName).toBe('Meu nome customizado')
  })

  it('unlisted (sem tussCode) NÃO tenta lookup — displayName é obrigatório no input', async () => {
    const sb = serviceClient()
    const created = await createProcedure(sb, {
      tenantId,
      tussCode: null,
      isUnlisted: true,
      displayName: 'PCT Amil',
    })
    expect(created.displayName).toBe('PCT Amil')
  })
})

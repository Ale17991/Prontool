/**
 * T051 (Feature 011) — fluxo end-to-end de despesa vinculada a imposto.
 *
 * - Cria imposto + despesa com vínculo → categoria forçada para 'impostos'
 * - Lista despesas → tax_name projetado no DTO
 * - Desativa imposto → GET /api/impostos não retorna mais (verifica filtro)
 *   mas despesa antiga preserva tax_id (rastreabilidade)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { createExpense } from '@/lib/core/expenses/create'
import { listExpenses } from '@/lib/core/expenses/list'
import { createTax } from '@/lib/core/taxes/create'
import { updateTax } from '@/lib/core/taxes/update'

describe('Feature 011 — fluxo despesa↔imposto (US3)', () => {
  let tenantId: string
  let adminUserId: string
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('exp-tax-flow')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  })

  it('cria imposto, despesa com vínculo, lista projeta tax_name, desativa, GET filtra ativos', async () => {
    const sb = serviceClient()

    // 1. Cria imposto
    const tax = await createTax(sb, {
      tenantId,
      name: 'ISS',
      rateBps: 500,
      category: 'municipal',
      actorUserId: adminUserId,
    })

    // 2. Cria despesa vinculada (passa category=aluguel para confirmar override)
    const expense = await createExpense(sb, {
      tenantId,
      category: 'aluguel', // será forçado para 'impostos'
      description: 'ISS abr/2026',
      amountCents: 25000,
      competenceDate: '2026-05-01',
      recurring: false,
      actorUserId: adminUserId,
      taxId: tax.id,
    })
    expect(expense.category).toBe('impostos')
    expect((expense as { tax_id?: string | null }).tax_id).toBe(tax.id)

    // 3. List projeta tax_name
    const listed = await listExpenses(sb, { tenantId, category: 'impostos' })
    const ours = listed.find((e) => e.id === expense.id)
    expect(ours).toBeDefined()
    expect((ours as { tax_name?: string | null }).tax_name).toBe('ISS')

    // 4. Desativa imposto
    await updateTax(sb, { tenantId, id: tax.id, isActive: false })

    // 5. GET /api/impostos (default só ativos) não retorna o desativado
    const { GET } = await import('@/app/api/impostos/route')
    const res = await GET(
      new Request('http://localhost/api/impostos', {
        headers: { authorization: `Bearer ${adminJwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string }>
    expect(body.find((r) => r.id === tax.id)).toBeUndefined()

    // 6. Mas a despesa antiga continua com tax_id preservado
    const stillListed = await listExpenses(sb, { tenantId, category: 'impostos' })
    const oldOne = stillListed.find((e) => e.id === expense.id)
    expect((oldOne as { tax_id?: string | null }).tax_id).toBe(tax.id)
    expect((oldOne as { tax_name?: string | null }).tax_name).toBe('ISS')
  })
})

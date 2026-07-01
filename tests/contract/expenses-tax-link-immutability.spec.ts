/**
 * T050 (Feature 011) — expenses.tax_id é imutável após insert.
 *
 * Trigger enforce_expenses_mutation foi estendido (migration 0076) para
 * incluir tax_id na lista de colunas imutáveis. Append-only mantido.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — expenses.tax_id imutável (Principle I)', () => {
  let tenantId: string
  let adminJwt: string
  let adminUserId: string
  let expenseId: string
  let taxA: string
  let taxB: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('exp-imm')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const sb = serviceClient()
    const { data: a } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: 'ISS',
        rate_bps: 500,
        category: 'municipal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    taxA = (a as unknown as { id: string }).id
    const { data: b } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: 'IRPJ',
        rate_bps: 1500,
        category: 'federal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    taxB = (b as unknown as { id: string }).id

    const expInsert = await sb
      .from('expenses')
      .insert({
        tenant_id: tenantId,
        category: 'impostos',
        description: 'ISS abr',
        amount_cents: 100,
        competence_date: '2026-05-01',
        recurring: false,
        created_by: adminUserId,
        tax_id: taxA,
      } as never)
      .select('id')
      .single()
    if (expInsert.error) throw new Error(`seed expense: ${expInsert.error.message}`)
    expenseId = (expInsert.data as unknown as { id: string }).id
  })

  it('UPDATE expenses SET tax_id (trocando para outro tax) é bloqueado pelo trigger', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb
      .from('expenses')
      .update({ tax_id: taxB } as never)
      .eq('id', expenseId)
    expect(error).not.toBeNull()
    // Estado intacto
    const sbSvc = serviceClient()
    const { data } = await sbSvc.from('expenses').select('tax_id').eq('id', expenseId).single()
    expect((data as { tax_id: string } | null)?.tax_id).toBe(taxA)
  })
})

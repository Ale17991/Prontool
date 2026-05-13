/**
 * Reprodução do bug reportado: procedimentos cadastrados com
 * `covered_by_plan=true` não aparecem na busca dentro de
 * /configuracoes/convenios/[id].
 *
 * Cenário do reporte:
 *   - Procedimento "Facectomia com lente intra-ocular" (TUSS 30306027)
 *     cadastrado com "Coberto por planos" marcado.
 *   - Convênio "Hospital Flavio Leal - Pirai" criado.
 *   - Ao abrir o convênio e buscar "facect": NENHUM resultado.
 *
 * Hipóteses a verificar:
 *   1. A query do loader retorna o procedimento?
 *   2. A query inclui procedimentos com `is_unlisted=true` + coberto?
 *   3. O label montado para `tuss_code=null` (unlisted) tem valor não-nulo?
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  resetDatabase,
  rlsClient,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedTussCode, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { createProcedure } from '@/lib/core/procedures/create'

describe('Bug repro — procedures sumindo na pagina do convenio', () => {
  let tenantId: string
  let adminJwt: string
  let listedProcId: string
  let unlistedProcId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('bug-conv-proc')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })

    // Cenário do bug: cadastrar TUSS 30306027 (Facectomia) coberto + ativo.
    await seedTussCode('30306027', {
      tussTable: '22',
      description: 'Facectomia com lente intra-ocular',
    })
    const sb = serviceClient()
    const created = await createProcedure(sb, {
      tenantId,
      tussCode: '30306027',
      displayName: 'Facectomia com lente intra-ocular',
      coveredByPlan: true,
      isUnlisted: false,
    })
    listedProcId = created.id

    // Procedimento NÃO listado coberto por plano (ex.: "PCT Amil")
    const unlisted = await createProcedure(sb, {
      tenantId,
      tussCode: null,
      displayName: 'PCT Amil',
      coveredByPlan: true,
      isUnlisted: true,
    })
    unlistedProcId = unlisted.id
  })

  it('procedimento listado coberto retorna na query do loader (rlsClient como admin)', async () => {
    const sb = rlsClient(adminJwt)
    const { data, error } = await sb
      .from('procedures')
      .select(
        'id, tuss_code, display_name, is_unlisted, custom_code_id, ' +
          'custom_procedure_codes:custom_code_id(code)',
      )
      .eq('active', true)
      .eq('covered_by_plan', true)
      .is('deleted_at', null)
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(1000)

    expect(error).toBeNull()
    const rows = (data ?? []) as unknown as Array<{ id: string }>
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(listedProcId)
  })

  it('procedimento NAO listado coberto tambem aparece', async () => {
    const sb = rlsClient(adminJwt)
    const { data } = await sb
      .from('procedures')
      .select('id, tuss_code, display_name, is_unlisted, covered_by_plan, active')
      .eq('active', true)
      .eq('covered_by_plan', true)
      .is('deleted_at', null)

    const found = (data ?? []).find((r) => r.id === unlistedProcId)
    expect(found).toBeDefined()
    expect((found as { tuss_code: string | null }).tuss_code).toBeNull()
  })

  it('CONTROLE: procedimento NAO coberto NAO aparece', async () => {
    const sb = serviceClient()
    const notCovered = await createProcedure(sb, {
      tenantId,
      tussCode: null,
      displayName: 'Procedimento particular',
      coveredByPlan: false,
      isUnlisted: true,
    })

    const rlsSb = rlsClient(adminJwt)
    const { data } = await rlsSb
      .from('procedures')
      .select('id')
      .eq('active', true)
      .eq('covered_by_plan', true)
      .is('deleted_at', null)
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).not.toContain(notCovered.id)
  })

  it('fluxo end-to-end: criar plano sem preco, buscar "facect", deve aparecer', async () => {
    const sb = serviceClient()

    // Criar plano sem nenhum preço cadastrado.
    const planRes = await sb
      .from('health_plans')
      .insert({ tenant_id: tenantId, name: 'Hospital Flavio Leal - Pirai' })
      .select('id')
      .single()
    if (planRes.error) throw new Error(`seed plan: ${planRes.error.message}`)
    const planId = (planRes.data as { id: string }).id

    // Loader simulando a página /configuracoes/convenios/[id]
    const rlsSb = rlsClient(adminJwt)
    const asOf = new Date().toISOString().slice(0, 10)

    const procRes = await rlsSb
      .from('procedures')
      .select(
        'id, tuss_code, display_name, is_unlisted, custom_code_id, ' +
          'custom_procedure_codes:custom_code_id(code)',
      )
      .eq('active', true)
      .eq('covered_by_plan', true)
      .is('deleted_at', null)
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(1000)

    expect(procRes.error).toBeNull()
    type RawProcRow = {
      id: string
      tuss_code: string | null
      display_name: string | null
      is_unlisted: boolean | null
      custom_code_id: string | null
      custom_procedure_codes: { code: string } | null
    }
    const rawProcs = (procRes.data ?? []) as unknown as RawProcRow[]
    const procedures = rawProcs.map((p) => {
      const codeFromCustom = p.custom_procedure_codes?.code ?? null
      const label = p.tuss_code ?? codeFromCustom ?? 'Não listado'
      return {
        id: p.id,
        tussCode: label,
        displayName: p.display_name,
      }
    })

    const pvRes = await rlsSb
      .from('price_versions')
      .select('id, procedure_id, amount_cents, valid_from, created_at')
      .eq('plan_id', planId)
      .lte('valid_from', asOf)

    const pvRows = (pvRes.data ?? []) as unknown as Array<{ procedure_id: string }>
    const pricedProcedureIds = new Set(pvRows.map((r) => r.procedure_id))
    const addable = procedures.filter((p) => !pricedProcedureIds.has(p.id))

    // O procedimento listado deve estar em `addable`.
    expect(addable.map((p) => p.id)).toContain(listedProcId)

    // Filtro client-side por "facect" deve achar.
    const search = 'facect'
    const q = search.toLowerCase()
    const filtered = addable.filter((p) => {
      const codeMatch =
        typeof p.tussCode === 'string' && p.tussCode.toLowerCase().includes(q)
      const nameMatch = (p.displayName ?? '').toLowerCase().includes(q)
      return codeMatch || nameMatch
    })
    expect(filtered.map((p) => p.id)).toContain(listedProcId)
  })
})

/**
 * T020 (Feature 052 US2) — sobrescritas manuais ponta a ponta.
 * Definir grava e recalcula; `null` desfaz; o valor sobrevive a reabrir.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

/**
 * Alimento SEM açúcares adicionados no JSONB — é o caso comum na base real
 * (7% de cobertura) e o motivo de a entrada manual existir.
 */
async function seedFoodWithoutSugar(): Promise<string> {
  const sb = serviceClient()
  const f = await sb
    .from('foods')
    .insert({
      tenant_id: null,
      source: 'af_bdalimentos',
      external_code: 'rot-manual-1',
      name: 'Massa de bolo (sem dado de açúcar adicionado)',
      reference_grams: 100,
      energy_kcal: 300,
      protein_g: 6,
      carb_g: 50,
      fat_g: 8,
      fiber_g: 2,
      micronutrients: { ag_saturados_g: 2, ag_trans_g: 0, sodio_mg: 200, acucar_total_g: 20 },
      active: true,
    } as never)
    .select('id')
    .single()
  if (f.error) throw new Error(`seed food: ${f.error.message}`)
  return (f.data as { id: string }).id
}

interface LabelPayload {
  label: { manualValues: Record<string, number> }
  result: {
    rows: { key: string; per100: number | null; state: string; missingFrom: string[] }[]
    incomplete: boolean
  }
}

describe('Feature 052 US2 — valores informados à mão', () => {
  let jwt: string
  let labelId: string

  async function patch(body: Record<string, unknown>): Promise<Response> {
    const { PATCH } = await import('@/app/api/rotulos/[id]/route')
    return PATCH(
      new Request(`http://localhost/api/rotulos/${labelId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      }),
      { params: { id: labelId } },
    )
  }

  async function read(): Promise<LabelPayload> {
    const { GET } = await import('@/app/api/rotulos/[id]/route')
    const res = await GET(
      new Request(`http://localhost/api/rotulos/${labelId}`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: labelId } },
    )
    expect(res.status).toBe(200)
    return (await res.json()) as LabelPayload
  }

  const row = (p: LabelPayload, key: string) => p.result.rows.find((r) => r.key === key)!

  beforeAll(async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('rotulo-manual')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const foodId = await seedFoodWithoutSugar()

    const { POST } = await import('@/app/api/rotulos/route')
    const res = await POST(
      new Request('http://localhost/api/rotulos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          productName: 'Bolo simples',
          basis: 'solido',
          totalYield: 900,
          portionSize: 60,
          ingredients: [{ foodId, grams: 1000 }],
        }),
      }),
    )
    expect(res.status).toBe(201)
    labelId = ((await res.json()) as { id: string }).id
  })

  it('nutriente sem dado na base vem incompleto — nunca zero', async () => {
    const p = await read()
    const r = row(p, 'acucares_adicionados')
    expect(r.state).toBe('incompleto')
    expect(r.per100).toBeNull()
    expect(r.missingFrom.length).toBeGreaterThan(0)
    expect(p.result.incomplete).toBe(true)
  })

  it('PATCH com valor grava a sobrescrita e recalcula', async () => {
    const res = await patch({ manualValues: { acucares_adicionados: 18.5 } })
    expect(res.status).toBe(200)
    const p = (await res.json()) as LabelPayload
    const r = row(p, 'acucares_adicionados')
    expect(r.state).toBe('sobrescrito')
    // O DECLARADO sai arredondado pelo Anexo III (≥10 → inteiro): 18,5 → 19…
    expect(r.per100).toBe(19)
    // …mas o informado é gravado em precisão cheia. Arredondar na gravação
    // tornaria o dado da profissional irrecuperável.
    expect(p.label.manualValues.acucares_adicionados).toBe(18.5)
  })

  it('a sobrescrita sobrevive a reabrir o rótulo', async () => {
    const p = await read()
    expect(row(p, 'acucares_adicionados').per100).toBe(19)
    expect(p.label.manualValues.acucares_adicionados).toBe(18.5)
  })

  it('PATCH com null remove a sobrescrita e volta ao estado anterior', async () => {
    const res = await patch({ manualValues: { acucares_adicionados: null } })
    expect(res.status).toBe(200)
    const p = (await res.json()) as LabelPayload
    const r = row(p, 'acucares_adicionados')
    // Desfazer devolve ao INCOMPLETO, não a zero: o dado nunca existiu.
    expect(r.state).toBe('incompleto')
    expect(r.per100).toBeNull()
    expect(p.label.manualValues.acucares_adicionados).toBeUndefined()
  })
})

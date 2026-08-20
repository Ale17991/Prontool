/**
 * T011 (Feature 052 US1) — contrato de `/api/rotulos`.
 * RBAC, gate de módulo, isolamento entre clínicas e validação de payload.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

async function seedFood(external: string): Promise<string> {
  const sb = serviceClient()
  const f = await sb
    .from('foods')
    .insert({
      tenant_id: null,
      source: 'af_bdalimentos',
      external_code: external,
      name: 'Farinha de trigo (rótulo)',
      reference_grams: 100,
      energy_kcal: 360,
      protein_g: 10,
      carb_g: 75,
      fat_g: 1,
      fiber_g: 2,
      micronutrients: {
        acucar_total_g: 1,
        acucar_adicao_g: 0,
        ag_saturados_g: 0.2,
        ag_trans_g: 0,
        sodio_mg: 2,
      },
      active: true,
    } as never)
    .select('id')
    .single()
  if (f.error) throw new Error(`seed food: ${f.error.message}`)
  return (f.data as { id: string }).id
}

function payload(foodId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productName: 'Bolo de cenoura',
    basis: 'solido',
    totalYield: 900,
    portionSize: 60,
    ingredients: [{ foodId, grams: 300 }],
    ...over,
  }
}

async function post(jwt: string, body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import('@/app/api/rotulos/route')
  return POST(
    new Request('http://localhost/api/rotulos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    }),
  )
}

async function get(jwt: string): Promise<Response> {
  const { GET } = await import('@/app/api/rotulos/route')
  return GET(
    new Request('http://localhost/api/rotulos', {
      headers: { authorization: `Bearer ${jwt}` },
    }),
  )
}

async function getOne(jwt: string, id: string): Promise<Response> {
  const { GET } = await import('@/app/api/rotulos/[id]/route')
  return GET(
    new Request(`http://localhost/api/rotulos/${id}`, {
      headers: { authorization: `Bearer ${jwt}` },
    }),
    { params: { id } },
  )
}

describe('Feature 052 — RBAC de /api/rotulos', () => {
  let tenantId: string
  let foodId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('rotulo-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    foodId = await seedFood('rot-rbac-1')
  })

  for (const role of roles) {
    const allowed = role === 'admin' || role === 'profissional_saude'
    it(`POST → ${allowed ? 201 : 403} para ${role}`, async () => {
      const res = await post(users[role], payload(foodId))
      expect(res.status).toBe(allowed ? 201 : 403)
    })
    it(`GET → ${allowed ? 200 : 403} para ${role}`, async () => {
      const res = await get(users[role])
      expect(res.status).toBe(allowed ? 200 : 403)
    })
  }
})

describe('Feature 052 — validação do payload', () => {
  let jwt: string
  let foodId: string

  beforeAll(async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('rotulo-valid')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    foodId = await seedFood('rot-valid-1')
  })

  it('corpo inválido → 400 INVALID_BODY', async () => {
    const res = await post(jwt, { productName: '', basis: 'gasoso' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_BODY')
  })

  it('porção maior que o rendimento → 422 PORTION_EXCEEDS_YIELD', async () => {
    const res = await post(jwt, payload(foodId, { totalYield: 50, portionSize: 60 }))
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'PORTION_EXCEEDS_YIELD',
    )
  })

  it('sem ingrediente nenhum → 400', async () => {
    const res = await post(jwt, payload(foodId, { ingredients: [] }))
    expect(res.status).toBe(400)
  })
})

describe('Feature 052 — gate do módulo nutri_rotulo (SC-007)', () => {
  it('sem o módulo, POST e GET → 404 mesmo para admin', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('rotulo-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const foodId = await seedFood('rot-nomod-1')
    const sb = serviceClient()
    const { error } = await sb.from('tenant_entitlements').insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['dieta'],
    } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    expect((await post(jwt, payload(foodId))).status).toBe(404)
    expect((await get(jwt)).status).toBe(404)
  })
})

describe('Feature 052 — isolamento entre clínicas (SC-008)', () => {
  it('rótulo de outra clínica não é acessível nem listado', async () => {
    await resetDatabase()
    const a = (await seedTenant('rotulo-iso-a')).tenantId
    const b = (await seedTenant('rotulo-iso-b')).tenantId
    const adminA = await seedUser(a, 'admin')
    const adminB = await seedUser(b, 'admin')
    const jwtA = mintJwt({ userId: adminA.userId, email: adminA.email, tenantId: a, role: 'admin' })
    const jwtB = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: b, role: 'admin' })
    const foodId = await seedFood('rot-iso-1')

    const created = await post(jwtA, payload(foodId))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }

    // O da clínica A abre normalmente para A…
    expect((await getOne(jwtA, id)).status).toBe(200)
    // …e é invisível para B, que não sabe sequer que ele existe.
    expect((await getOne(jwtB, id)).status).toBe(404)

    const listB = (await (await get(jwtB)).json()) as { labels: { id: string }[] }
    expect(listB.labels.map((l) => l.id)).not.toContain(id)
  })
})

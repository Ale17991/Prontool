/**
 * T014 (Feature 050 US1) — contrato da rota de exames laboratoriais.
 * RBAC por papel, gate do módulo `exames_lab`, isolamento entre clínicas,
 * validação de corpo e atomicidade do lote.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
const ROUTE = (id: string) => `http://localhost/api/pacientes/${id}/exames`

async function postExames(patientId: string, jwt: string, body: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/pacientes/[id]/exames/route')
  return POST(
    new Request(ROUTE(patientId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    }),
    { params: { id: patientId } },
  )
}

async function getExames(patientId: string, jwt: string, qs = ''): Promise<Response> {
  const { GET } = await import('@/app/api/pacientes/[id]/exames/route')
  return GET(
    new Request(`${ROUTE(patientId)}${qs}`, {
      headers: { authorization: `Bearer ${jwt}` },
    }),
    { params: { id: patientId } },
  )
}

const laudo = {
  measured_at: '2026-07-20',
  results: [{ analyte_key: 'lab_ferritina', value: 120 }],
}

describe('Feature 050 — RBAC da rota de exames', () => {
  let patientId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('exames-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    patientId = await seedPatient(tenantId)
  })

  for (const role of roles) {
    const allowed = role === 'admin' || role === 'profissional_saude'
    it(`POST → ${allowed ? 201 : 403} para ${role}`, async () => {
      const res = await postExames(patientId, users[role], laudo)
      expect(res.status).toBe(allowed ? 201 : 403)
    })

    it(`GET → ${allowed ? 200 : 403} para ${role}`, async () => {
      const res = await getExames(patientId, users[role])
      expect(res.status).toBe(allowed ? 200 : 403)
    })
  }
})

describe('Feature 050 — gate do módulo exames_lab (SC-005)', () => {
  let patientId: string
  let jwt: string

  beforeAll(async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('exames-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    const { error } = await sb.from('tenant_entitlements').insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['dieta'], // qualquer coisa menos exames_lab
    } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)
    jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  })

  it('sem o módulo, POST → 404 mesmo para admin', async () => {
    const res = await postExames(patientId, jwt, laudo)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('MODULE_DISABLED')
  })

  it('sem o módulo, GET → 404 (a existência da tela não vaza)', async () => {
    const res = await getExames(patientId, jwt)
    expect(res.status).toBe(404)
  })
})

describe('Feature 050 — isolamento entre clínicas (SC-006)', () => {
  it('não devolve o paciente de outra clínica', async () => {
    await resetDatabase()
    const a = (await seedTenant('exames-iso-a')).tenantId
    const b = (await seedTenant('exames-iso-b')).tenantId
    const adminA = await seedUser(a, 'admin')
    const patientB = await seedPatient(b)
    const jwtA = mintJwt({ userId: adminA.userId, email: adminA.email, tenantId: a, role: 'admin' })

    const res = await postExames(patientB, jwtA, laudo)
    expect(res.status).toBe(404)
  })
})

describe('Feature 050 — validação e atomicidade do laudo', () => {
  let patientId: string
  let jwt: string

  beforeAll(async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('exames-valid')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    patientId = await seedPatient(tenantId)
    jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  })

  it('corpo inválido → 400 INVALID_BODY', async () => {
    const res = await postExames(patientId, jwt, { measured_at: '20/07/2026', results: [] })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('analito fora do catálogo → 400', async () => {
    const res = await postExames(patientId, jwt, {
      measured_at: '2026-07-20',
      results: [{ analyte_key: 'peso', value: 80 }],
    })
    expect(res.status).toBe(400)
  })

  it('valor absurdo → 422 e NADA do lote é gravado', async () => {
    // A faixa plausível é anti-typo: hemoglobina 9000 g/dL não passa. O lote
    // inteiro é rejeitado, então a ferritina válida ao lado também não entra.
    const res = await postExames(patientId, jwt, {
      measured_at: '2026-07-20',
      results: [
        { analyte_key: 'lab_ferritina', value: 120 },
        { analyte_key: 'lab_hemoglobina', value: 9000 },
      ],
    })
    expect(res.status).toBe(422)

    const sb = serviceClient()
    const { data } = await sb
      .from('patient_measurements')
      .select('metric_type')
      .eq('patient_id', patientId)
    expect(data ?? []).toHaveLength(0)
  })

  it('um resultado clinicamente MUITO alterado ainda assim é aceito', async () => {
    // O risco desta feature é a faixa plausível apertada rejeitar justamente o
    // caso que mais importa registrar. Ferritina 2000 mcg/L é gravíssima e real.
    const res = await postExames(patientId, jwt, {
      measured_at: '2026-07-21',
      results: [{ analyte_key: 'lab_ferritina', value: 2000 }],
    })
    expect(res.status).toBe(201)
  })

  it('sem sexo no cadastro, ainda classifica o que não depende de sexo (FR-006)', async () => {
    // Em produção 699 de 712 pacientes não têm sexo e 667 não têm nascimento.
    // Exigir os dois bloquearia tudo — quando 69 das 85 faixas são iguais para
    // ambos os sexos. TSH tem faixa `any`: precisa classificar mesmo assim.
    const sb = serviceClient()
    const ins = await sb.from('lab_reference_ranges').insert({
      analyte_key: 'lab_tsh',
      sex: 'any',
      age_min_years: 0,
      age_max_years: 130,
      state: 'padrao',
      ref_min: 1,
      ref_max: 2.5,
      unit: 'mUI/L',
      source_label: 'teste',
    } as never)
    if (ins.error) throw new Error(ins.error.message)

    const post = await postExames(patientId, jwt, {
      measured_at: '2026-07-22',
      results: [{ analyte_key: 'lab_tsh', value: 8 }],
    })
    expect(post.status).toBe(201)

    const res = await getExames(patientId, jwt)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      panel: { items: Array<{ analyteKey: string; class: string }> } | null
      need?: { age: boolean; sex: boolean; blockedBySex: number }
      series: Record<string, unknown>
    }
    expect(body.panel).not.toBeNull()
    const tsh = body.panel!.items.find((i) => i.analyteKey === 'lab_tsh')
    expect(tsh?.class).toBe('alto')
    expect(body.need?.sex).toBe(true)
    expect(Object.keys(body.series)).toContain('lab_ferritina')
  })

  it('sinaliza quantos exames ficaram sem classificar por falta de sexo', async () => {
    // A ferritina lançada antes só tem faixa por sexo (M/F, sem `any`), então
    // fica "sem referência" e conta como motivo concreto para pedir o dado.
    const sb = serviceClient()
    const ins = await sb.from('lab_reference_ranges').insert([
      {
        analyte_key: 'lab_ferritina',
        sex: 'M',
        age_min_years: 0,
        age_max_years: 130,
        state: 'padrao',
        ref_min: 70,
        ref_max: 150,
        unit: 'mcg/L',
        source_label: 'teste',
      },
      {
        analyte_key: 'lab_ferritina',
        sex: 'F',
        age_min_years: 0,
        age_max_years: 130,
        state: 'padrao',
        ref_min: 70,
        ref_max: 200,
        unit: 'mcg/L',
        source_label: 'teste',
      },
    ] as never)
    if (ins.error) throw new Error(ins.error.message)

    const res = await getExames(patientId, jwt)
    const body = (await res.json()) as {
      panel: { items: Array<{ analyteKey: string; class: string }> }
      need: { sex: boolean; blockedBySex: number }
    }
    const ferritina = body.panel.items.find((i) => i.analyteKey === 'lab_ferritina')
    expect(ferritina?.class).toBe('sem_referencia')
    expect(body.need.blockedBySex).toBeGreaterThanOrEqual(1)
  })

  it('GET com sexo e idade por query param classifica sem depender do cadastro', async () => {
    const sb = serviceClient()
    // Upsert: o teste anterior deste bloco já pode ter semeado esta faixa.
    const { error } = await sb.from('lab_reference_ranges').upsert(
      {
        analyte_key: 'lab_ferritina',
        sex: 'M',
        age_min_years: 0,
        age_max_years: 130,
        state: 'padrao',
        ref_min: 70,
        ref_max: 150,
        unit: 'mcg/L',
        source_label: 'teste',
      } as never,
      { onConflict: 'analyte_key,sex,age_min_years,age_max_years,state' },
    )
    if (error) throw new Error(error.message)

    const res = await getExames(patientId, jwt, '?sex=M&age=40')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      patient: { sex: string; ageYears: number }
      panel: { items: Array<{ analyteKey: string; class: string }>; high: number }
    }
    expect(body.patient).toMatchObject({ sex: 'M', ageYears: 40 })
    const ferritina = body.panel.items.find((i) => i.analyteKey === 'lab_ferritina')
    expect(ferritina?.class).toBe('alto') // 2000 contra teto 150
    expect(body.panel.high).toBeGreaterThanOrEqual(1)
  })
})

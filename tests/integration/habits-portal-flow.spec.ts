/**
 * Checklist de hábitos — fluxo REAL do portal, com sessão de paciente.
 *
 * Existe porque o defeito relatado foi "não aparece na página do paciente": a
 * cadeia inteira (módulo → seção do portal → grade → marcação) precisa de um
 * teste que atravesse tudo, e não só das partes isoladas.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import {
  createPatientSessionCookie,
  PATIENT_SESSION_COOKIE_NAME,
} from '@/lib/core/patient-portal/session'
import { saveChecklist } from '@/lib/core/habits/store'

const ITEMS = [
  { id: 'agua', label: 'Bebeu pelo menos 2 litros de água?' },
  { id: 'treino', label: 'Fez atividade física hoje?' },
]

interface GridPayload {
  grid: {
    checklist: { title: string; items: { id: string; label: string }[] }
    period: { startDate: string; endDate: string; days: string[] }
    marks: { itemId: string; markDate: string }[]
  } | null
}

describe('checklist no portal do paciente', () => {
  let tenantId: string
  let patientId: string
  let cookie: string

  function headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      cookie: `${PATIENT_SESSION_COOKIE_NAME}=${cookie}`,
    }
  }

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('habitos-portal-flow')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    patientId = await seedPatient(tenantId)
    cookie = createPatientSessionCookie({ patientId, tenantId })

    await saveChecklist(serviceClient(), {
      tenantId,
      patientId,
      actorUserId: admin.userId,
      title: 'Meus hábitos',
      periodKind: 'semanal',
      // Início antigo o bastante para "hoje" cair sempre dentro de algum
      // período — o teste não pode depender da data em que roda.
      startDate: '2020-01-06',
      items: ITEMS,
    })
  })

  async function getGrid(): Promise<GridPayload> {
    const { GET } = await import('@/app/api/paciente/habitos/route')
    const res = await GET(
      new Request('http://localhost/api/paciente/habitos', { headers: headers() }) as never,
    )
    expect(res.status).toBe(200)
    return (await res.json()) as GridPayload
  }

  it('a seção do portal nasce ligada e o paciente recebe a grade', async () => {
    const { grid } = await getGrid()
    expect(grid, 'grade não chegou ao portal').not.toBeNull()
    expect(grid!.checklist.title).toBe('Meus hábitos')
    expect(grid!.checklist.items.map((i) => i.id)).toEqual(['agua', 'treino'])
    expect(grid!.period.days).toHaveLength(7)
  })

  it('o paciente marca e a marcação volta na mesma resposta', async () => {
    const { POST } = await import('@/app/api/paciente/habitos/route')
    const antes = await getGrid()
    const hoje = antes.grid!.period.days.find((d) => d <= new Date().toISOString().slice(0, 10))!

    const res = await POST(
      new Request('http://localhost/api/paciente/habitos', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ itemId: 'agua', markDate: hoje, marked: true }),
      }) as never,
    )
    expect(res.status).toBe(200)
    const { grid } = (await res.json()) as GridPayload
    expect(grid!.marks.some((m) => m.itemId === 'agua' && m.markDate === hoje)).toBe(true)
  })

  it('sem o módulo habitos o portal não devolve grade', async () => {
    await resetDatabase()
    const outro = (await seedTenant('habitos-portal-nomod')).tenantId
    const admin = await seedUser(outro, 'admin')
    const p = await seedPatient(outro)
    const { error } = await serviceClient()
      .from('tenant_entitlements')
      .insert({ tenant_id: outro, plan: 'pro', status: 'active', modules: ['dieta'] } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)
    await saveChecklist(serviceClient(), {
      tenantId: outro,
      patientId: p,
      actorUserId: admin.userId,
      title: 'Meus hábitos',
      periodKind: 'semanal',
      startDate: '2020-01-06',
      items: ITEMS,
    })

    const { GET } = await import('@/app/api/paciente/habitos/route')
    const res = await GET(
      new Request('http://localhost/api/paciente/habitos', {
        headers: { cookie: `${PATIENT_SESSION_COOKIE_NAME}=${createPatientSessionCookie({ patientId: p, tenantId: outro })}` },
      }) as never,
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as GridPayload).grid).toBeNull()
  })
})

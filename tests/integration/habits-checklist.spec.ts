/**
 * Checklist de hábitos — persistência e, sobretudo, os limites da escrita do
 * paciente. É a primeira vez que o portal aceita gravação, então o que se testa
 * aqui é o que NÃO pode acontecer: marcar hábito de outro paciente, marcar
 * hábito inexistente, e reescrever período fechado.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import {
  getGrid,
  getHistory,
  saveChecklist,
  toggleMark,
  HabitMarkError,
} from '@/lib/core/habits/store'

const ITEMS = [
  { id: 'agua', label: 'Bateu a meta de água?' },
  { id: 'treino', label: 'Treinou hoje?' },
]

describe('checklist de hábitos', () => {
  let tenantId: string
  let otherTenantId: string
  let patientId: string
  let otherPatientId: string
  let actorUserId: string
  const START = '2026-08-03' // segunda
  const TODAY = '2026-08-06' // quinta da mesma semana

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('habitos')).tenantId
    otherTenantId = (await seedTenant('habitos-b')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)
    otherPatientId = await seedPatient(tenantId)

    await saveChecklist(serviceClient(), {
      tenantId,
      patientId,
      actorUserId,
      title: 'Meus hábitos',
      periodKind: 'semanal',
      startDate: START,
      items: ITEMS,
    })
  })

  it('a grade traz o período corrente com os dias da semana', async () => {
    const grid = await getGrid(serviceClient(), { tenantId, patientId, today: TODAY })
    expect(grid).not.toBeNull()
    expect(grid!.period.startDate).toBe('2026-08-03')
    expect(grid!.period.endDate).toBe('2026-08-09')
    expect(grid!.period.days).toHaveLength(7)
    expect(grid!.checklist.items).toHaveLength(2)
  })

  it('marca, e marcar de novo não duplica', async () => {
    const sb = serviceClient()
    await toggleMark(sb, { tenantId, patientId, itemId: 'agua', markDate: TODAY, marked: true, today: TODAY })
    await toggleMark(sb, { tenantId, patientId, itemId: 'agua', markDate: TODAY, marked: true, today: TODAY })
    const grid = await getGrid(sb, { tenantId, patientId, today: TODAY })
    // Toque duplo no celular não pode virar dois dias marcados.
    expect(grid!.marks.filter((m) => m.itemId === 'agua' && m.markDate === TODAY)).toHaveLength(1)
    expect(grid!.stats.find((s) => s.itemId === 'agua')!.markedDays).toBe(1)
  })

  it('aceita dia retroativo DENTRO do período', async () => {
    const sb = serviceClient()
    await toggleMark(sb, {
      tenantId, patientId, itemId: 'agua', markDate: '2026-08-04', marked: true, today: TODAY,
    })
    const grid = await getGrid(sb, { tenantId, patientId, today: TODAY })
    expect(grid!.stats.find((s) => s.itemId === 'agua')!.markedDays).toBe(2)
  })

  it('recusa dia FORA do período corrente', async () => {
    const sb = serviceClient()
    // Reescrever período fechado corromperia o histórico que a clínica lê.
    await expect(
      toggleMark(sb, {
        tenantId, patientId, itemId: 'agua', markDate: '2026-07-20', marked: true, today: TODAY,
      }),
    ).rejects.toBeInstanceOf(HabitMarkError)
  })

  it('recusa hábito que não está na grade DESTE paciente', async () => {
    const sb = serviceClient()
    await expect(
      toggleMark(sb, {
        tenantId, patientId, itemId: 'inventado', markDate: TODAY, marked: true, today: TODAY,
      }),
    ).rejects.toBeInstanceOf(HabitMarkError)
  })

  it('desmarcar apaga — o branco volta a ser ambíguo, não vira "não fiz"', async () => {
    const sb = serviceClient()
    await toggleMark(sb, { tenantId, patientId, itemId: 'agua', markDate: TODAY, marked: false, today: TODAY })
    const grid = await getGrid(sb, { tenantId, patientId, today: TODAY })
    expect(grid!.marks.some((m) => m.itemId === 'agua' && m.markDate === TODAY)).toBe(false)
    // Desmarcar de novo é idempotente, não erro.
    await expect(
      toggleMark(sb, { tenantId, patientId, itemId: 'agua', markDate: TODAY, marked: false, today: TODAY }),
    ).resolves.toEqual({ marked: false })
  })

  it('paciente sem checklist não tem grade, e marcar falha', async () => {
    const sb = serviceClient()
    expect(await getGrid(sb, { tenantId, patientId: otherPatientId, today: TODAY })).toBeNull()
    await expect(
      toggleMark(sb, {
        tenantId, patientId: otherPatientId, itemId: 'agua', markDate: TODAY, marked: true, today: TODAY,
      }),
    ).rejects.toBeInstanceOf(HabitMarkError)
  })

  it('outra clínica não enxerga o checklist', async () => {
    const grid = await getGrid(serviceClient(), {
      tenantId: otherTenantId,
      patientId,
      today: TODAY,
    })
    expect(grid).toBeNull()
  })

  it('ajustar a grade do paciente não some com o histórico de marcações', async () => {
    const sb = serviceClient()
    await toggleMark(sb, { tenantId, patientId, itemId: 'treino', markDate: TODAY, marked: true, today: TODAY })
    const before = await getGrid(sb, { tenantId, patientId, today: TODAY })
    const checklistId = before!.checklist.id

    await saveChecklist(sb, {
      tenantId,
      patientId,
      actorUserId,
      id: checklistId,
      title: 'Meus hábitos (ajustado)',
      periodKind: 'semanal',
      startDate: START,
      items: [...ITEMS, { id: 'sono', label: 'Dormiu 7h?' }],
    })

    const after = await getGrid(sb, { tenantId, patientId, today: TODAY })
    expect(after!.checklist.id).toBe(checklistId)
    expect(after!.checklist.items).toHaveLength(3)
    expect(after!.stats.find((s) => s.itemId === 'treino')!.markedDays).toBe(1)
  })

  it('histórico devolve períodos anteriores já encerrados', async () => {
    const sb = serviceClient()
    // "Hoje" três semanas depois do início → 2 períodos fechados atrás.
    const history = await getHistory(sb, { tenantId, patientId, today: '2026-08-24' })
    expect(history.length).toBeGreaterThanOrEqual(2)
    // O mais recente vem primeiro.
    expect(history[0]!.periodIndex).toBeGreaterThan(history[1]!.periodIndex)
    const primeiraSemana = history.find((h) => h.startDate === '2026-08-03')
    expect(primeiraSemana?.stats.find((s) => s.itemId === 'treino')?.markedDays).toBe(1)
  })
})

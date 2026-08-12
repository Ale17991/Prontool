/**
 * T048/T049 (Feature 056) — as fontes de checklist.
 *
 * Ficam em `integration/` e não em `unit/` como o tasks.md previa: as fontes
 * consultam o banco por natureza (grade do paciente + marcações), e um teste
 * que precise de Supabase é teste de integração, por mais simples que a lógica
 * seja. Testar a aritmética de período à parte seria testar o motor da 0189,
 * que já tem os próprios testes.
 *
 * O caso que mais importa é o da BORDA DE PERÍODO: um gatilho de "3 vezes na
 * semana" precisa recomeçar a contagem quando a semana vira, senão a mensagem
 * de segunda-feira é decidida pelas marcações da semana passada.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'
import { getSource } from '@/lib/core/automations/sources'

const sb = serviceClient()

async function enc(plain: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')
  const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
  if (error) throw new Error(error.message)
  return data as unknown as string
}

async function seedPaciente(
  tenantId: string,
  opts: { optIn?: boolean; comTelefone?: boolean } = {},
): Promise<string> {
  const id = randomUUID()
  const row: Record<string, unknown> = {
    id,
    tenant_id: tenantId,
    full_name_enc: await enc('Maria'),
    status: 'ativo',
    reminders_opt_in: true,
    automations_opt_in: opts.optIn ?? true,
  }
  if (opts.comTelefone !== false) row.phone_enc = await enc('5527988887777')
  const { error } = await sb.from('patients').insert(row as never)
  if (error) throw new Error(`paciente: ${error.message}`)
  return id
}

async function seedChecklist(
  tenantId: string,
  patientId: string,
  itens: Array<{ id: string; label: string }>,
  startDate = '2026-08-10',
): Promise<string> {
  const { data, error } = await sb
    .from('patient_habit_checklists' as never)
    .insert({
      tenant_id: tenantId,
      patient_id: patientId,
      title: 'Hábitos',
      period_kind: 'semanal',
      start_date: startDate,
      items: itens,
      active: true,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`checklist: ${error.message}`)
  return (data as unknown as { id: string }).id
}

async function marcar(
  tenantId: string,
  checklistId: string,
  patientId: string,
  itemId: string,
  datas: string[],
): Promise<void> {
  for (const d of datas) {
    const { error } = await sb.from('habit_checklist_marks' as never).insert({
      tenant_id: tenantId,
      checklist_id: checklistId,
      patient_id: patientId,
      item_id: itemId,
      mark_date: d,
    } as never)
    if (error) throw new Error(`marca ${d}: ${error.message}`)
  }
}

function ctx(tenantId: string, today: string, params: Record<string, unknown>) {
  return { supabase: sb, tenantId, today, timezone: 'America/Sao_Paulo', clinicName: 'Clínica', params }
}

const ITENS = [
  { id: 'alcool', label: 'Bebi álcool' },
  { id: 'agua', label: 'Bati a meta de água' },
]

describe('fonte: hábito marcado N vezes no período', () => {
  const fonte = getSource('checklist_marcado')!
  let tenantId: string
  let patientId: string
  let checklistId: string

  beforeEach(async () => {
    await resetDatabase()
    tenantId = (await seedTenant(`chk-${randomUUID().slice(0, 6)}`)).tenantId
    patientId = await seedPaciente(tenantId)
    // Semana de 10/08 (seg) a 16/08 (dom).
    checklistId = await seedChecklist(tenantId, patientId, ITENS, '2026-08-10')
  })

  it('atingiu o limiar → vira candidato', async () => {
    await marcar(tenantId, checklistId, patientId, 'alcool', [
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ])
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-12', { itemId: 'alcool', vezes: 3 }))
    expect(r).toHaveLength(1)
    expect(r[0]?.patientId).toBe(patientId)
    expect(r[0]?.variables.habito).toBe('Bebi álcool')
    expect(r[0]?.variables.vezes).toBe('3')
  })

  it('abaixo do limiar → não entra', async () => {
    await marcar(tenantId, checklistId, patientId, 'alcool', ['2026-08-10', '2026-08-11'])
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-12', { itemId: 'alcool', vezes: 3 }))
    expect(r).toHaveLength(0)
  })

  it('a chave é do PERÍODO — marcar mais vezes na mesma semana não muda', async () => {
    await marcar(tenantId, checklistId, patientId, 'alcool', [
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ])
    const tres = await fonte.enumerate(ctx(tenantId, '2026-08-12', { itemId: 'alcool', vezes: 3 }))
    await marcar(tenantId, checklistId, patientId, 'alcool', ['2026-08-13'])
    const quatro = await fonte.enumerate(ctx(tenantId, '2026-08-13', { itemId: 'alcool', vezes: 3 }))
    // Mesma chave nas duas → o motor grava uma ocorrência só.
    expect(quatro[0]?.occurrenceKey).toBe(tres[0]?.occurrenceKey)
  })

  it('BORDA: a semana seguinte recomeça a contagem', async () => {
    await marcar(tenantId, checklistId, patientId, 'alcool', [
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ])
    // 17/08 é a segunda-feira seguinte: período novo, contagem zerada.
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-17', { itemId: 'alcool', vezes: 3 }))
    expect(r).toHaveLength(0)
  })

  it('item que não está na grade DAQUELE paciente não dispara', async () => {
    // A grade é ajustável por paciente — quem não tem o hábito não é cobrado.
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-12', { itemId: 'fumo', vezes: 1 }))
    expect(r).toHaveLength(0)
  })

  it('paciente sem consentimento de automações não é enumerado', async () => {
    const outro = await seedPaciente(tenantId, { optIn: false })
    const c2 = await seedChecklist(tenantId, outro, ITENS, '2026-08-10')
    await marcar(tenantId, c2, outro, 'alcool', ['2026-08-10', '2026-08-11', '2026-08-12'])
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-12', { itemId: 'alcool', vezes: 3 }))
    expect(r.some((c) => c.patientId === outro)).toBe(false)
  })

  it('checklist inativo sai da avaliação', async () => {
    await marcar(tenantId, checklistId, patientId, 'alcool', [
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ])
    await sb
      .from('patient_habit_checklists' as never)
      .update({ active: false } as never)
      .eq('id', checklistId)
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-12', { itemId: 'alcool', vezes: 3 }))
    expect(r).toHaveLength(0)
  })
})

describe('fonte: hábito sem marcação há N dias', () => {
  const fonte = getSource('checklist_sem_marcacao')!
  let tenantId: string
  let patientId: string
  let checklistId: string

  beforeEach(async () => {
    await resetDatabase()
    tenantId = (await seedTenant(`chk2-${randomUUID().slice(0, 6)}`)).tenantId
    patientId = await seedPaciente(tenantId)
    checklistId = await seedChecklist(tenantId, patientId, ITENS, '2026-08-10')
  })

  it('sem nenhuma marcação na janela → vira candidato', async () => {
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-13', { itemId: 'agua', dias: 3 }))
    expect(r).toHaveLength(1)
    expect(r[0]?.variables.habito).toBe('Bati a meta de água')
    expect(r[0]?.variables.dias).toBe('3')
  })

  it('uma marcação dentro da janela já tira o paciente', async () => {
    await marcar(tenantId, checklistId, patientId, 'agua', ['2026-08-12'])
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-13', { itemId: 'agua', dias: 3 }))
    expect(r).toHaveLength(0)
  })

  it('não acusa antes de a janela caber no período', async () => {
    // Checklist começou em 10/08; em 11/08 não existem 5 dias para julgar.
    const r = await fonte.enumerate(ctx(tenantId, '2026-08-11', { itemId: 'agua', dias: 5 }))
    expect(r).toHaveLength(0)
  })

  it('FR-009: a fonte declara o aviso, e ele fala de MARCAÇÃO', async () => {
    expect(fonte.warning).toBeTruthy()
    expect(fonte.warning).toMatch(/marc/i)
    expect(fonte.warning).toMatch(/nunca/i)
  })
})

/**
 * T035 (Feature 056) — `automation_occurrences` é append-only, com DUAS
 * exceções declaradas na migration 0196.
 *
 * O que este arquivo protege é a fronteira das exceções. Append-only "exceto
 * quando dá trabalho" não é append-only: se o UPDATE pudesse reescrever um
 * desfecho já final, o registro deixaria de provar o que aconteceu — e é ele
 * que responde "por que este paciente recebeu esta mensagem".
 *
 * Constituição, Princípio II (auditabilidade).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedPatient } from '@/tests/helpers/seed-factories'

const sb = serviceClient()

async function seedAutomacao(tenantId: string): Promise<string> {
  const { data: msg, error: e1 } = await sb
    .from('message_templates' as never)
    .insert({ tenant_id: tenantId, name: 'M1', body: 'Oi {{paciente}}' } as never)
    .select('id')
    .single()
  if (e1) throw new Error(`msg: ${e1.message}`)

  const { data: trg, error: e2 } = await sb
    .from('automation_triggers' as never)
    .insert({ tenant_id: tenantId, name: 'G1', source: 'aniversario', params: {} } as never)
    .select('id')
    .single()
  if (e2) throw new Error(`trigger: ${e2.message}`)

  const { data: aut, error: e3 } = await sb
    .from('automations' as never)
    .insert({
      tenant_id: tenantId,
      trigger_id: (trg as { id: string }).id,
      message_template_id: (msg as { id: string }).id,
    } as never)
    .select('id')
    .single()
  if (e3) throw new Error(`automation: ${e3.message}`)
  return (aut as { id: string }).id
}

async function novaOcorrencia(
  tenantId: string,
  automationId: string,
  patientId: string,
  outcome: string,
  key = randomUUID(),
): Promise<string> {
  const { data, error } = await sb
    .from('automation_occurrences' as never)
    .insert({
      tenant_id: tenantId,
      automation_id: automationId,
      patient_id: patientId,
      occurrence_key: key,
      outcome,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`ocorrência: ${error.message}`)
  return (data as { id: string }).id
}

describe('Feature 056 — automation_occurrences append-only', () => {
  let tenantId: string
  let automationId: string
  let patientId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('auto-append')).tenantId
    patientId = await seedPatient(tenantId)
    automationId = await seedAutomacao(tenantId)
  })

  it('a MESMA (automação, paciente, chave) não entra duas vezes', async () => {
    const key = randomUUID()
    await novaOcorrencia(tenantId, automationId, patientId, 'pendente', key)

    const { error } = await sb.from('automation_occurrences' as never).insert({
      tenant_id: tenantId,
      automation_id: automationId,
      patient_id: patientId,
      occurrence_key: key,
      outcome: 'pendente',
    } as never)

    // É este índice que torna "uma vez só" propriedade do banco, e não
    // disciplina de código.
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23505')
  })

  it('EXCEÇÃO 1: pendente → desfecho final é permitido', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'pendente')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'enviado' } as never)
      .eq('id', id)
    expect(error).toBeNull()
  })

  it('desfecho já final NÃO pode ser reescrito', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'enviado')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'falhou' } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/append-only/i)
  })

  it('a transição não pode trocar paciente nem chave', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'pendente')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'enviado', occurrence_key: 'outra-chave' } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('EXCEÇÃO 2: linha suprimida por teto pode ser apagada, para reavaliação', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'suprimido_teto_clinica')
    const { error } = await sb.from('automation_occurrences' as never).delete().eq('id', id)
    // Sem isto, o paciente que ficou de fora por acaso de ordenação perderia a
    // mensagem para sempre — a chave estaria consumida.
    expect(error).toBeNull()
  })

  it('linha ENVIADA não pode ser apagada', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'enviado')
    const { error } = await sb.from('automation_occurrences' as never).delete().eq('id', id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/append-only/i)
  })

  it('linha impedida também não pode ser apagada', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'impedido_sem_telefone')
    const { error } = await sb.from('automation_occurrences' as never).delete().eq('id', id)
    expect(error).not.toBeNull()
  })
})

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
    .insert({
      tenant_id: tenantId,
      name: `M-${randomUUID().slice(0, 6)}`,
      body: 'Oi {{paciente}}',
    } as never)
    .select('id')
    .single()
  if (e1) throw new Error(`msg: ${e1.message}`)

  const { data: trg, error: e2 } = await sb
    .from('automation_triggers' as never)
    .insert({
      tenant_id: tenantId,
      name: `G-${randomUUID().slice(0, 6)}`,
      source: 'aniversario',
      params: {},
    } as never)
    .select('id')
    .single()
  if (e2) throw new Error(`trigger: ${e2.message}`)

  const { data: aut, error: e3 } = await sb
    .from('automations' as never)
    .insert({
      tenant_id: tenantId,
      name: `Auto ${(trg as { id: string }).id.slice(0, 8)}`,
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
    const { error } = await sb
      .from('automation_occurrences' as never)
      .delete()
      .eq('id', id)
    // Sem isto, o paciente que ficou de fora por acaso de ordenação perderia a
    // mensagem para sempre — a chave estaria consumida.
    expect(error).toBeNull()
  })

  it('linha ENVIADA não pode ser apagada', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'enviado')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .delete()
      .eq('id', id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/append-only/i)
  })

  it('linha impedida também não pode ser apagada', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'impedido_sem_telefone')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .delete()
      .eq('id', id)
    expect(error).not.toBeNull()
  })
})

/**
 * A terceira exceção, da migration 0203, e a mais recente: `falhou` volta a
 * `pendente` para o ciclo tentar de novo.
 *
 * Ela existe por causa de um caso real — na primeira tentativa de envio em
 * produção o serviço de WhatsApp respondeu 502, a ocorrência ficou `falhou`, e
 * aí se descobriu que aquilo era definitivo: a linha não pode ser apagada e a
 * chave fica ocupada, então o paciente nunca mais receberia aquela mensagem por
 * causa de uma indisponibilidade passageira.
 */
describe('Feature 056 — retentativa de falha (0203)', () => {
  let tenantId: string
  let automationId: string
  let patientId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('auto-retry')).tenantId
    patientId = await seedPatient(tenantId)
    automationId = await seedAutomacao(tenantId)
  })

  it('falhou volta a pendente quando as tentativas crescem', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'falhou')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'pendente', attempts: 2 } as never)
      .eq('id', id)
    expect(error).toBeNull()
  })

  /**
   * O contador é a única contenção que existe: sem exigir o incremento, um bug
   * no motor reabriria a mesma linha para sempre, ocupando a vaga do ciclo (uma
   * mensagem a cada 5 minutos) e calando as outras automações da clínica.
   */
  it('reabrir SEM incrementar a tentativa é recusado', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'falhou')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'pendente' } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/append-only/i)
  })

  it('falhou não pode virar enviado direto, sem passar por pendente', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'falhou')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'enviado', attempts: 2 } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  /**
   * Impedido continua final — com UMA exceção, que a 0207 abriu e que os três
   * testes abaixo delimitam. Sem consentimento, sem telefone e sem variável são
   * estados do mundo, não indisponibilidade: retentar seria insistir com quem
   * disse não.
   */
  it('impedido NÃO é reaberto, mesmo incrementando a tentativa', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'impedido_sem_consentimento')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'pendente', attempts: 2 } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  /**
   * A 0207, e a fronteira que ela move.
   *
   * Em 21/08/2026 o número da clínica ficou fora do ar por uma hora e meia, e as
   * cinco ocorrências daquele intervalo foram gravadas `impedido_sem_conexao` —
   * final, com o UNIQUE impedindo qualquer outra no lugar. Cinco avisos de "sua
   * consulta é hoje" que não chegaram e nunca mais chegariam.
   *
   * Número fora do ar não é estado do mundo: é a mesma indisponibilidade
   * passageira que fez a 0203 abrir `falhou`. Estava na família errada.
   */
  it('impedido_sem_conexao VOLTA a pendente quando as tentativas crescem', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'impedido_sem_conexao')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'pendente', attempts: 2 } as never)
      .eq('id', id)
    expect(error).toBeNull()
  })

  it('impedido_sem_conexao sem incrementar a tentativa é recusado', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'impedido_sem_conexao')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'pendente' } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('a exceção é só para conexão — sem telefone continua final', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'impedido_sem_telefone')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .update({ outcome: 'pendente', attempts: 2 } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  /**
   * A 0205: excluir a AUTOMAÇÃO é recusado quando ela já produziu ocorrência.
   *
   * A 0196 dizia CASCADE e nunca funcionou — o DELETE cascateado esbarrava neste
   * mesmo trigger e derrubava a exclusão inteira, com uma mensagem que falava de
   * outra tabela. Ninguém percebeu porque, até 14/08/2026, nenhuma automação em
   * produção havia enviado nada.
   */
  it('automação que já produziu ocorrência não pode ser excluída', async () => {
    await novaOcorrencia(tenantId, automationId, patientId, 'enviado')
    const { error } = await sb
      .from('automations' as never)
      .delete()
      .eq('id', automationId)
    expect(error).not.toBeNull()
    // 23503 é a FK da 0205 recusando — e NÃO o 42501 do trigger, que era o
    // sintoma antigo e apontava para o lugar errado.
    expect((error as { code?: string })?.code).toBe('23503')
  })

  it('automação que nunca enviou continua excluível', async () => {
    const limpa = await seedAutomacao(tenantId)
    const { error } = await sb
      .from('automations' as never)
      .delete()
      .eq('id', limpa)
    expect(error).toBeNull()
  })

  it('linha que falhou continua sem poder ser apagada', async () => {
    const id = await novaOcorrencia(tenantId, automationId, patientId, 'falhou')
    const { error } = await sb
      .from('automation_occurrences' as never)
      .delete()
      .eq('id', id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/append-only/i)
  })
})

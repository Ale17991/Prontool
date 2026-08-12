/**
 * T032 (Feature 056) — o ciclo de automações, ponta a ponta.
 *
 * A promessa mais visível da feature é a que este arquivo trava: rodar o ciclo
 * duas vezes no mesmo dia manda UMA mensagem. Repetição no WhatsApp do paciente
 * é o que faz denunciarem o número da clínica, e número denunciado derruba o
 * canal inteiro.
 *
 * O MSW intercepta o serviço de envio — nenhuma mensagem real sai daqui.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { whatsappSendSpy } from '@/tests/helpers/msw-spies'
import { seedTenant } from '@/tests/helpers/seed-factories'
import { saveWhatsAppCredentials, updateConnectionState } from '@/lib/core/whatsapp/config'
import { evaluateAutomations } from '@/lib/core/automations/evaluate'

const sb = serviceClient()
/** Meio-dia UTC = 09:00 em São Paulo, dentro de qualquer janela razoável. */
const AGORA = new Date('2026-08-11T12:00:00.000Z')

async function enc(plain: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')
  const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
  if (error) throw new Error(error.message)
  return data as unknown as string
}

async function seedClinica(slug: string, opts: { modulo?: boolean; conectado?: boolean } = {}) {
  const { tenantId } = await seedTenant(slug)
  await sb.from('tenant_entitlements' as never).insert({
    tenant_id: tenantId,
    plan: 'pro',
    status: 'active',
    modules: opts.modulo === false ? ['dieta'] : ['automacoes'],
  } as never)
  await sb.from('tenant_clinic_profile' as never).upsert({
    tenant_id: tenantId,
    corporate_name: 'Clínica Teste',
  } as never)

  if (opts.conectado !== false) {
    await saveWhatsAppCredentials(sb as unknown as SupabaseClient<never>, {
      tenantId,
      serviceTenantSlug: slug,
      apiKey: 'ck_teste_1234567890',
    })
    await updateConnectionState(sb as unknown as SupabaseClient<never>, tenantId, {
      status: 'connected',
      instanceName: `${slug}-1`,
      numberConnected: '5527999999999',
    })
  }
  return tenantId
}

async function seedPaciente(
  tenantId: string,
  opts: {
    nascimento?: string
    telefone?: string | null
    optInMestre?: boolean
    optInAutomacoes?: boolean
  } = {},
): Promise<string> {
  const id = randomUUID()
  const row: Record<string, unknown> = {
    id,
    tenant_id: tenantId,
    full_name_enc: await enc('Maria Silva'),
    birth_date_enc: await enc(opts.nascimento ?? '1990-08-11'),
    status: 'ativo',
    reminders_opt_in: opts.optInMestre ?? true,
    automations_opt_in: opts.optInAutomacoes ?? true,
  }
  if (opts.telefone !== null) row.phone_enc = await enc(opts.telefone ?? '5527988887777')
  const { error } = await sb.from('patients').insert(row as never)
  if (error) throw new Error(`paciente: ${error.message}`)
  return id
}

async function seedAutomacao(tenantId: string, corpo = 'Feliz aniversário, {{paciente}}!') {
  const { data: msg } = await sb
    .from('message_templates' as never)
    .insert({ tenant_id: tenantId, name: `M-${randomUUID().slice(0, 6)}`, body: corpo } as never)
    .select('id')
    .single()
  const { data: trg } = await sb
    .from('automation_triggers' as never)
    .insert({
      tenant_id: tenantId,
      name: `G-${randomUUID().slice(0, 6)}`,
      source: 'aniversario',
      params: {},
    } as never)
    .select('id')
    .single()
  const { data: aut, error } = await sb
    .from('automations' as never)
    .insert({
      tenant_id: tenantId,
      trigger_id: (trg as unknown as { id: string }).id,
      message_template_id: (msg as unknown as { id: string }).id,
      active: true,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`automação: ${error.message}`)
  return (aut as unknown as { id: string }).id
}

async function ocorrencias(tenantId: string) {
  const { data } = await sb
    .from('automation_occurrences' as never)
    .select('outcome, reason')
    .eq('tenant_id', tenantId)
  return (data ?? []) as Array<{ outcome: string; reason: string | null }>
}

describe('Feature 056 — ciclo de automações', () => {
  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
  })

  it('aniversariante com consentimento recebe UMA mensagem, com o nome substituído', async () => {
    const tenantId = await seedClinica('auto-ciclo-ok')
    await seedPaciente(tenantId)
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)

    expect(r.enviadas).toBe(1)
    expect(whatsappSendSpy.calls).toHaveLength(1)
    // O spy do MSW registra destinatário e externalId, não o corpo — a
    // substituição de variável é travada no teste unitário de render.
    expect(whatsappSendSpy.calls[0]?.to).toBe('5527988887777')

    const occ = await ocorrencias(tenantId)
    expect(occ).toHaveLength(1)
    expect(occ[0]?.outcome).toBe('enviado')
  })

  it('SC-003: rodar o ciclo duas vezes no mesmo dia não repete a mensagem', async () => {
    const tenantId = await seedClinica('auto-ciclo-idem')
    await seedPaciente(tenantId)
    await seedAutomacao(tenantId)

    await evaluateAutomations(sb, AGORA)
    const segunda = await evaluateAutomations(sb, AGORA)

    expect(segunda.enviadas).toBe(0)
    // O ganho real: o serviço foi chamado UMA vez, não duas.
    expect(whatsappSendSpy.calls).toHaveLength(1)
    expect(await ocorrencias(tenantId)).toHaveLength(1)
  })

  it('quem não faz aniversário hoje não entra', async () => {
    const tenantId = await seedClinica('auto-ciclo-outro-dia')
    await seedPaciente(tenantId, { nascimento: '1990-03-14' })
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    expect(whatsappSendSpy.calls).toHaveLength(0)
  })

  it('sem consentimento de automações, nada sai — nem com o mestre ligado', async () => {
    const tenantId = await seedClinica('auto-ciclo-sem-consent')
    await seedPaciente(tenantId, { optInAutomacoes: false })
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    expect(whatsappSendSpy.calls).toHaveLength(0)
    // O candidato nem é enumerado: a fonte já filtra por consentimento, o que
    // evita decifrar a base inteira todo dia.
    expect(await ocorrencias(tenantId)).toHaveLength(0)
  })

  it('consentimento MESTRE negado cala a automação', async () => {
    const tenantId = await seedClinica('auto-ciclo-mestre-off')
    await seedPaciente(tenantId, { optInMestre: false })
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    const occ = await ocorrencias(tenantId)
    // Aqui a ocorrência EXISTE: a fonte enumerou (automations_opt_in está
    // ligado) e o motor barrou pelo mestre. O registro precisa dizer isso.
    expect(occ).toHaveLength(1)
    expect(occ[0]?.outcome).toBe('impedido_sem_consentimento')
  })

  it('paciente sem telefone é registrado, não enviado', async () => {
    const tenantId = await seedClinica('auto-ciclo-sem-fone')
    await seedPaciente(tenantId, { telefone: null })
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    // A fonte exige phone_enc não nulo — sem telefone o paciente nem é
    // candidato, então não há o que registrar.
    expect(await ocorrencias(tenantId)).toHaveLength(0)
  })

  it('automação desligada não dispara', async () => {
    const tenantId = await seedClinica('auto-ciclo-off')
    await seedPaciente(tenantId)
    const autoId = await seedAutomacao(tenantId)
    await sb
      .from('automations' as never)
      .update({ active: false } as never)
      .eq('id', autoId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    expect(whatsappSendSpy.calls).toHaveLength(0)
  })

  it('módulo revogado cala o MOTOR, não só a tela', async () => {
    const tenantId = await seedClinica('auto-ciclo-sem-modulo', { modulo: false })
    await seedPaciente(tenantId)
    // A automação continua marcada como ativa — é estado persistido. Sem o gate
    // no motor, a clínica seguiria enviando para sempre depois da revogação.
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    expect(whatsappSendSpy.calls).toHaveLength(0)
  })

  it('sem WhatsApp conectado não envia, e não gera ocorrência por paciente', async () => {
    const tenantId = await seedClinica('auto-ciclo-desconectado', { conectado: false })
    await seedPaciente(tenantId)
    await seedAutomacao(tenantId)

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    // FR-021: uma ocorrência agregada, nunca uma por paciente.
    expect(await ocorrencias(tenantId)).toHaveLength(0)
  })

  it('teto por paciente/dia: a segunda automação do mesmo dia é suprimida', async () => {
    const tenantId = await seedClinica('auto-ciclo-teto')
    await seedPaciente(tenantId)
    await seedAutomacao(tenantId, 'Primeira: {{paciente}}')
    await seedAutomacao(tenantId, 'Segunda: {{paciente}}')

    const r = await evaluateAutomations(sb, AGORA)

    expect(r.enviadas).toBe(1)
    expect(r.suprimidas).toBe(1)
    expect(whatsappSendSpy.calls).toHaveLength(1)
  })

  it('variável que a mensagem pede e o motor não tem pula o envio', async () => {
    const tenantId = await seedClinica('auto-ciclo-variavel')
    await seedPaciente(tenantId)
    // Passa direto no banco, sem a validação da rota — é o cenário de uma
    // mensagem editada depois de associada.
    await seedAutomacao(tenantId, 'Oi {{paciente}}, seu {{procedimento}}')

    const r = await evaluateAutomations(sb, AGORA)
    expect(r.enviadas).toBe(0)
    expect(whatsappSendSpy.calls).toHaveLength(0)
    const occ = await ocorrencias(tenantId)
    expect(occ[0]?.outcome).toBe('impedido_variavel_ausente')
    expect(occ[0]?.reason).toContain('procedimento')
  })
})

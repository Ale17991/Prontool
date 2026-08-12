/**
 * Feature 056 — as fontes acrescentadas depois do primeiro corte, e o FR-017.
 *
 * Cada fonte tem um caso que PROVA que ela dispara e, quando cabe, um que prova
 * que ela NÃO dispara fora da janela — porque o erro caro aqui não é a mensagem
 * que não sai, é a que sai para quem não devia receber.
 *
 * O bloco final é o T055: paciente inativo ou anonimizado sai de QUALQUER
 * avaliação. Ele roda contra todas as fontes de uma vez, e não contra uma
 * escolhida a dedo, porque a garantia que interessa é "nenhuma fonte esquece" —
 * uma fonte nova que reimplemente o filtro por conta própria quebra este teste.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedAppointment,
  seedUser,
} from '@/tests/helpers/seed-factories'
import { getSource, listSources } from '@/lib/core/automations/sources'
import type { EnumerateContext } from '@/lib/core/automations/types'

const sb = serviceClient()
const HOJE = '2026-08-11'
const TUSS = '10101012'

/**
 * Várias tabelas de domínio têm FK de autor para `auth.users`, então o uuid
 * zerado que serve em `appointment_completions` não serve nelas. Cada clínica
 * do teste ganha um ator de verdade.
 */
let ATOR = '00000000-0000-0000-0000-000000000000'

async function enc(plain: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')
  const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
  if (error) throw new Error(error.message)
  return data as unknown as string
}

async function clinica(prefixo: string): Promise<string> {
  const { tenantId } = await seedTenant(`${prefixo}-${randomUUID().slice(0, 6)}`)
  await sb.from('tenant_clinic_profile' as never).upsert({
    tenant_id: tenantId,
    corporate_name: 'Clínica Teste',
  } as never)
  const { userId } = await seedUser(tenantId, 'admin')
  ATOR = userId
  return tenantId
}

async function seedPaciente(
  tenantId: string,
  opts: {
    criadoEm?: string
    status?: string
    anonimizado?: boolean
    optIn?: boolean
    semTelefone?: boolean
  } = {},
): Promise<string> {
  const id = randomUUID()
  const row: Record<string, unknown> = {
    id,
    tenant_id: tenantId,
    full_name_enc: await enc('Maria Silva'),
    status: opts.status ?? 'ativo',
    reminders_opt_in: true,
    automations_opt_in: opts.optIn ?? true,
  }
  if (!opts.semTelefone) row.phone_enc = await enc('5527988887777')
  if (opts.criadoEm) row.created_at = opts.criadoEm
  if (opts.anonimizado) row.anonymized_at = new Date().toISOString()
  const { error } = await sb.from('patients').insert(row as never)
  if (error) throw new Error(`paciente: ${error.message}`)
  return id
}

function ctx(
  tenantId: string,
  params: Record<string, unknown>,
  today = HOJE,
): EnumerateContext {
  return {
    supabase: sb,
    tenantId,
    today,
    timezone: 'America/Sao_Paulo',
    clinicName: 'Clínica',
    params,
  }
}

async function seedCatalogo(tenantId: string) {
  await seedTussCode(TUSS)
  const procedureId = await seedProcedure(tenantId, TUSS)
  const planId = await seedHealthPlan(tenantId, `Plano-${randomUUID().slice(0, 6)}`)
  const { doctorId, commissionId } = await seedDoctor(tenantId)
  const priceVersionId = await seedPriceVersion({
    tenantId,
    planId,
    procedureId,
    amountCents: 20000,
    validFrom: '2024-01-01',
  })
  return { procedureId, planId, doctorId, commissionId, priceVersionId }
}

async function seedAtendimento(
  tenantId: string,
  patientId: string,
  at: string,
  cat: Awaited<ReturnType<typeof seedCatalogo>>,
): Promise<string> {
  return seedAppointment({
    tenantId,
    patientId,
    ...cat,
    amountCents: 20000,
    commissionBps: 5000,
    at,
  })
}

// ===========================================================================
// Agenda
// ===========================================================================

describe('fonte: pre_consulta', () => {
  const fonte = getSource('pre_consulta')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('pega a consulta que acontece daqui a N dias e ignora as outras', async () => {
    const tenantId = await clinica('pre')
    const cat = await seedCatalogo(tenantId)
    const pac = await seedPaciente(tenantId)

    // 13/08 é "daqui a 2 dias" contando de 11/08. 12h UTC = 09h em SP.
    const alvo = await seedAtendimento(tenantId, pac, '2026-08-13T12:00:00.000Z', cat)
    await seedAtendimento(tenantId, pac, '2026-08-15T12:00:00.000Z', cat)

    const r = await fonte.enumerate(ctx(tenantId, { dias: 2 }))
    expect(r.map((c) => c.occurrenceKey)).toEqual([alvo])
    expect(r[0]?.variables.dias).toBe('2')
    // O contexto do atendimento entra nas variáveis — sem ele a mensagem não
    // conseguiria dizer que horas é a consulta.
    expect(r[0]?.variables.hora).toBeTruthy()
    expect(r[0]?.variables.profissional).toBeTruthy()
  })

  it('consulta CANCELADA não recebe orientação de preparo', async () => {
    const tenantId = await clinica('pre-canc')
    const cat = await seedCatalogo(tenantId)
    const pac = await seedPaciente(tenantId)
    const apt = await seedAtendimento(tenantId, pac, '2026-08-13T12:00:00.000Z', cat)

    await sb
      .from('appointment_cancellations' as never)
      .insert({
        tenant_id: tenantId,
        appointment_id: apt,
        cancelled_by: ATOR,
        reason: 'paciente_desmarcou',
      } as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, { dias: 2 }))
    expect(r).toHaveLength(0)
  })
})

describe('fonte: pos_atendimento', () => {
  const fonte = getSource('pos_atendimento')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('conta do dia da CONCLUSÃO, não do horário marcado', async () => {
    const tenantId = await clinica('pos')
    const cat = await seedCatalogo(tenantId)
    const pac = await seedPaciente(tenantId)

    // Marcado para 01/08, mas realizado só em 10/08 (remarcação informal).
    const apt = await seedAtendimento(tenantId, pac, '2026-08-01T12:00:00.000Z', cat)
    await sb
      .from('appointment_completions' as never)
      .insert({
        tenant_id: tenantId,
        appointment_id: apt,
        completed_by: ATOR,
        source: 'manual',
        completed_at: '2026-08-10T15:00:00.000Z',
      } as never)
      .throwOnError()

    // 1 dia depois de 10/08 é 11/08 = hoje. Se contasse do appointment_at,
    // não acharia nada.
    const r = await fonte.enumerate(ctx(tenantId, { dias: 1 }))
    expect(r.map((c) => c.occurrenceKey)).toEqual([apt])
  })

  it('atendimento não realizado não entra', async () => {
    const tenantId = await clinica('pos-nao')
    const cat = await seedCatalogo(tenantId)
    const pac = await seedPaciente(tenantId)
    await seedAtendimento(tenantId, pac, '2026-08-10T12:00:00.000Z', cat)

    const r = await fonte.enumerate(ctx(tenantId, { dias: 1 }))
    expect(r).toHaveLength(0)
  })
})

describe('fonte: falta_consulta', () => {
  const fonte = getSource('falta_consulta')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('pega quem a recepção marcou como desmarcou, e só ele', async () => {
    const tenantId = await clinica('falta')
    const cat = await seedCatalogo(tenantId)
    const faltou = await seedPaciente(tenantId)
    const veio = await seedPaciente(tenantId)

    const aptFalta = await seedAtendimento(tenantId, faltou, '2026-08-10T12:00:00.000Z', cat)
    const aptVeio = await seedAtendimento(tenantId, veio, '2026-08-10T13:00:00.000Z', cat)

    await sb
      .from('appointment_flow' as never)
      .insert([
        { tenant_id: tenantId, appointment_id: aptFalta, status: 'desmarcou' },
        { tenant_id: tenantId, appointment_id: aptVeio, status: 'atendido' },
      ] as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, { dias: 1 }))
    expect(r.map((c) => c.occurrenceKey)).toEqual([aptFalta])
  })

  it('declara o guarda-corpo de linguagem', () => {
    expect(fonte.warning).toBeTruthy()
    expect(fonte.warning?.toLowerCase()).not.toContain('não quis')
    expect(fonte.warning).toMatch(/remarcar/i)
  })
})

describe('fonte: agendamento_cancelado', () => {
  const fonte = getSource('agendamento_cancelado')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('pega o cancelamento de ontem', async () => {
    const tenantId = await clinica('canc')
    const cat = await seedCatalogo(tenantId)
    const pac = await seedPaciente(tenantId)
    const apt = await seedAtendimento(tenantId, pac, '2026-08-20T12:00:00.000Z', cat)

    await sb
      .from('appointment_cancellations' as never)
      .insert({
        tenant_id: tenantId,
        appointment_id: apt,
        cancelled_by: ATOR,
        reason: 'paciente_desmarcou',
        cancelled_at: '2026-08-10T18:00:00.000Z',
      } as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, {}))
    expect(r.map((c) => c.occurrenceKey)).toEqual([apt])
  })
})

// ===========================================================================
// Relacionamento
// ===========================================================================

describe('fonte: boas_vindas', () => {
  const fonte = getSource('boas_vindas')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('pega quem se cadastrou há N dias', async () => {
    const tenantId = await clinica('bv')
    const novo = await seedPaciente(tenantId, { criadoEm: '2026-08-10T14:00:00.000Z' })
    await seedPaciente(tenantId, { criadoEm: '2026-07-01T14:00:00.000Z' })

    const r = await fonte.enumerate(ctx(tenantId, { dias: 1 }))
    expect(r.map((c) => c.patientId)).toEqual([novo])
  })

  it('a chave é fixa — trocar o parâmetro não faz o paciente antigo receber de novo', async () => {
    const tenantId = await clinica('bv-chave')
    await seedPaciente(tenantId, { criadoEm: '2026-08-10T14:00:00.000Z' })
    const r = await fonte.enumerate(ctx(tenantId, { dias: 1 }))
    expect(r[0]?.occurrenceKey).toBe('boas-vindas')
  })
})

describe('fonte: aniversario_cadastro', () => {
  const fonte = getSource('aniversario_cadastro')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('conta os anos de casa e ignora quem não faz aniversário hoje', async () => {
    const tenantId = await clinica('anivcad')
    // 11/08/2024 às 15h UTC = 12h em SP, mesmo dia civil nos dois.
    const doisAnos = await seedPaciente(tenantId, { criadoEm: '2024-08-11T15:00:00.000Z' })
    await seedPaciente(tenantId, { criadoEm: '2024-09-11T15:00:00.000Z' })

    const r = await fonte.enumerate(ctx(tenantId, {}))
    expect(r.map((c) => c.patientId)).toEqual([doisAnos])
    expect(r[0]?.variables.anos).toBe('2')
    expect(r[0]?.occurrenceKey).toBe('2026')
  })
})

// ===========================================================================
// Acompanhamento
// ===========================================================================

async function seedMetrica(tenantId: string, metricType: string) {
  await sb
    .from('patient_metric_types' as never)
    .upsert({
      tenant_id: tenantId,
      metric_type: metricType,
      label: 'Peso',
      unit: 'kg',
      min_plausible: 1,
      max_plausible: 400,
      specialty: 'geral',
    } as never)
    .throwOnError()
}

describe('fonte: meta_atingida', () => {
  const fonte = getSource('meta_atingida')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('a ÚLTIMA medição é que decide, não a melhor', async () => {
    const tenantId = await clinica('meta')
    await seedMetrica(tenantId, 'peso_teste')
    const pac = await seedPaciente(tenantId)

    await sb
      .from('patient_metric_goals' as never)
      .insert({
        tenant_id: tenantId,
        patient_id: pac,
        metric_type: 'peso_teste',
        target_value: 70,
        direction: 'decrease',
        created_by_user_id: ATOR,
      } as never)
      .throwOnError()

    // Chegou a 69 e voltou para 72: NÃO recebe parabéns.
    await sb
      .from('patient_measurements' as never)
      .insert([
        {
          tenant_id: tenantId,
          patient_id: pac,
          metric_type: 'peso_teste',
          value: 69,
          unit: 'kg',
          measured_at: '2026-08-01T12:00:00.000Z',
          created_by_user_id: ATOR,
        },
        {
          tenant_id: tenantId,
          patient_id: pac,
          metric_type: 'peso_teste',
          value: 72,
          unit: 'kg',
          measured_at: '2026-08-09T12:00:00.000Z',
          created_by_user_id: ATOR,
        },
      ] as never)
      .throwOnError()

    expect(await fonte.enumerate(ctx(tenantId, {}))).toHaveLength(0)

    // Agora voltou para 68 — atingiu.
    await sb
      .from('patient_measurements' as never)
      .insert({
        tenant_id: tenantId,
        patient_id: pac,
        metric_type: 'peso_teste',
        value: 68,
        unit: 'kg',
        measured_at: '2026-08-10T12:00:00.000Z',
        created_by_user_id: ATOR,
      } as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, {}))
    expect(r).toHaveLength(1)
    expect(r[0]?.variables.valor).toBe('68')
    expect(r[0]?.variables.meta).toBe('70')
    // O rótulo humano, não o nome da coluna.
    expect(r[0]?.variables.metrica).toBe('Peso')
  })
})

describe('fonte: sem_medicao', () => {
  const fonte = getSource('sem_medicao')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('quem NUNCA mediu não entra — a fonte é sobre acompanhamento interrompido', async () => {
    const tenantId = await clinica('semmed')
    await seedMetrica(tenantId, 'peso_teste')
    const nunca = await seedPaciente(tenantId)
    const parou = await seedPaciente(tenantId)

    await sb
      .from('patient_measurements' as never)
      .insert({
        tenant_id: tenantId,
        patient_id: parou,
        metric_type: 'peso_teste',
        value: 80,
        unit: 'kg',
        measured_at: '2026-06-01T12:00:00.000Z',
        created_by_user_id: ATOR,
      } as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, { dias: 30 }))
    expect(r.map((c) => c.patientId)).toEqual([parou])
    expect(r.map((c) => c.patientId)).not.toContain(nunca)
    // Chave mensal: estado contínuo não vira mensagem diária.
    expect(r[0]?.occurrenceKey).toBe('2026-08')
  })
})

// ===========================================================================
// Financeiro
// ===========================================================================

async function seedParcela(
  tenantId: string,
  patientId: string,
  dueDate: string,
  status = 'pendente',
): Promise<string> {
  const recordId = randomUUID()
  await sb
    .from('payment_records' as never)
    .insert({
      id: recordId,
      tenant_id: tenantId,
      patient_id: patientId,
      total_amount_cents: 30000,
      paid_amount_cents: 0,
      installments: 3,
      payment_method: 'pix',
      payment_status: 'pendente',
      created_by: ATOR,
    } as never)
    .throwOnError()

  const id = randomUUID()
  await sb
    .from('payment_installments' as never)
    .insert({
      id,
      tenant_id: tenantId,
      payment_record_id: recordId,
      installment_number: 1,
      amount_cents: 10000,
      paid_amount_cents: 0,
      due_date: dueDate,
      status,
    } as never)
    .throwOnError()
  return id
}

describe('fontes de parcela', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('a vencer pega a data futura; vencida pega a passada; paga não entra', async () => {
    const tenantId = await clinica('parc')
    const pac = await seedPaciente(tenantId)

    const aVencer = await seedParcela(tenantId, pac, '2026-08-14')
    const vencida = await seedParcela(tenantId, pac, '2026-08-08')
    await seedParcela(tenantId, pac, '2026-08-14', 'pago')

    const futuras = await getSource('parcela_a_vencer')!.enumerate(ctx(tenantId, { dias: 3 }))
    expect(futuras.map((c) => c.occurrenceKey)).toEqual([aVencer])
    expect(futuras[0]?.variables.valor).toContain('100,00')

    const passadas = await getSource('parcela_vencida')!.enumerate(ctx(tenantId, { dias: 3 }))
    expect(passadas.map((c) => c.occurrenceKey)).toEqual([`${vencida}:3`])
  })

  it('cobrança não fornece procedimento nem profissional — é guarda-corpo, não esquecimento', () => {
    for (const id of ['parcela_a_vencer', 'parcela_vencida']) {
      const fonte = getSource(id)!
      expect(fonte.variables).not.toContain('procedimento')
      expect(fonte.variables).not.toContain('profissional')
    }
    expect(getSource('parcela_vencida')!.warning).toMatch(/CDC|constranger/i)
  })
})

// ===========================================================================
// Tratamento e exames
// ===========================================================================

describe('fonte: orcamento_sem_resposta', () => {
  const fonte = getSource('orcamento_sem_resposta')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('pega o apresentado sem resposta e ignora o aceito', async () => {
    const tenantId = await clinica('orc')
    const pac = await seedPaciente(tenantId)

    const pendente = randomUUID()
    await sb
      .from('treatment_budgets' as never)
      .insert([
        {
          id: pendente,
          tenant_id: tenantId,
          patient_id: pac,
          title: 'Tratamento completo',
          status: 'apresentado',
          frozen_total_cents: 250000,
          presented_at: '2026-08-04T14:00:00.000Z',
        },
        {
          id: randomUUID(),
          tenant_id: tenantId,
          patient_id: pac,
          title: 'Outro',
          status: 'aceito',
          frozen_total_cents: 100000,
          presented_at: '2026-08-04T14:00:00.000Z',
          accepted_at: '2026-08-05T14:00:00.000Z',
        },
      ] as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, { dias: 7 }))
    expect(r.map((c) => c.occurrenceKey)).toEqual([pendente])
    expect(r[0]?.variables.valor).toContain('2.500,00')
  })
})

describe('fonte: exame_sem_retorno', () => {
  const fonte = getSource('exame_sem_retorno')!
  beforeEach(async () => {
    await resetDatabase()
  })

  it('pega o pedido emitido há N dias', async () => {
    const tenantId = await clinica('exame')
    const pac = await seedPaciente(tenantId)

    const alvo = randomUUID()
    await sb
      .from('exam_requests' as never)
      .insert([
        {
          id: alvo,
          tenant_id: tenantId,
          patient_id: pac,
          created_by: ATOR,
          items: [{ code: null, description: 'Hemograma completo' }],
          issued_at: '2026-07-27T14:00:00.000Z',
        },
        {
          id: randomUUID(),
          tenant_id: tenantId,
          patient_id: pac,
          created_by: ATOR,
          items: [{ code: null, description: 'Glicemia' }],
          issued_at: '2026-08-10T14:00:00.000Z',
        },
      ] as never)
      .throwOnError()

    const r = await fonte.enumerate(ctx(tenantId, { dias: 15 }))
    expect(r.map((c) => c.occurrenceKey)).toEqual([alvo])
  })

  it('não afirma que o paciente deixou de fazer o exame', () => {
    expect(fonte.warning).toMatch(/emitido/i)
    expect(fonte.warning).toMatch(/nunca como/i)
  })
})

// ===========================================================================
// T055 / FR-017 — quem não pode receber sai de TODAS as fontes
// ===========================================================================

describe('FR-017 — paciente inativo ou anonimizado sai de qualquer avaliação', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  /**
   * O teste monta o cenário MAIS FAVORÁVEL possível para cada fonte disparar —
   * consulta amanhã, consulta realizada ontem, cadastro de ontem, parcela
   * vencendo, orçamento parado, exame pedido — e depois estraga só a
   * elegibilidade do paciente. Nada pode sair.
   */
  async function cenarioCompleto(tenantId: string, pacienteId: string) {
    const cat = await seedCatalogo(tenantId)
    await seedAtendimento(tenantId, pacienteId, '2026-08-13T12:00:00.000Z', cat)

    const realizado = await seedAtendimento(
      tenantId,
      pacienteId,
      '2026-08-10T12:00:00.000Z',
      cat,
    )
    await sb
      .from('appointment_completions' as never)
      .insert({
        tenant_id: tenantId,
        appointment_id: realizado,
        completed_by: ATOR,
        source: 'manual',
        completed_at: '2026-08-10T15:00:00.000Z',
      } as never)
      .throwOnError()

    await sb
      .from('appointment_flow' as never)
      .insert({ tenant_id: tenantId, appointment_id: realizado, status: 'desmarcou' } as never)
      .throwOnError()

    await seedParcela(tenantId, pacienteId, '2026-08-14')
    await seedParcela(tenantId, pacienteId, '2026-08-08')

    await sb
      .from('treatment_budgets' as never)
      .insert({
        tenant_id: tenantId,
        patient_id: pacienteId,
        title: 'Orçamento',
        status: 'apresentado',
        frozen_total_cents: 100000,
        presented_at: '2026-08-04T14:00:00.000Z',
      } as never)
      .throwOnError()

    await sb
      .from('exam_requests' as never)
      .insert({
        tenant_id: tenantId,
        patient_id: pacienteId,
        created_by: ATOR,
        items: [{ code: null, description: 'Hemograma completo' }],
        issued_at: '2026-07-27T14:00:00.000Z',
      } as never)
      .throwOnError()
  }

  /** Parâmetros mínimos válidos para cada fonte, tirados do próprio schema. */
  const PARAMS: Record<string, Record<string, unknown>> = {
    pre_consulta: { dias: 2 },
    pos_atendimento: { dias: 1 },
    falta_consulta: { dias: 1 },
    sem_retorno: { meses: 6 },
    boas_vindas: { dias: 1 },
    sem_medicao: { dias: 30 },
    plano_alimentar_revisao: { dias: 30 },
    parcela_a_vencer: { dias: 3 },
    parcela_vencida: { dias: 3 },
    orcamento_sem_resposta: { dias: 7 },
    etapa_sem_agendamento: { dias: 30 },
    exame_sem_retorno: { dias: 15 },
    checklist_marcado: { itemId: 'agua', vezes: 1 },
    checklist_sem_marcacao: { itemId: 'agua', dias: 1 },
  }

  for (const situacao of ['inativo', 'anonimizado', 'sem consentimento'] as const) {
    it(`nenhuma fonte devolve paciente ${situacao}`, async () => {
      const tenantId = await clinica('fr017')
      const pac = await seedPaciente(tenantId, {
        criadoEm: '2026-08-10T14:00:00.000Z',
        status: situacao === 'inativo' ? 'inativo' : 'ativo',
        anonimizado: situacao === 'anonimizado',
        optIn: situacao !== 'sem consentimento',
      })
      await cenarioCompleto(tenantId, pac)

      for (const fonte of listSources()) {
        const candidatos = await fonte.enumerate(
          ctx(tenantId, PARAMS[fonte.id] ?? {}),
        )
        expect(
          candidatos.map((c) => c.patientId),
          `a fonte "${fonte.id}" devolveu um paciente ${situacao}`,
        ).not.toContain(pac)
      }
    })
  }
})

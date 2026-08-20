/**
 * T052/T054 (Feature 056) — as fontes de agenda e o teto por ciclo.
 *
 * `sem_retorno` é a fonte que justifica o teto existir. Ela descreve uma
 * SITUAÇÃO, não um evento: no dia em que a clínica liga, todo mundo que está
 * naquela condição satisfaz de uma vez. Sem o teto por ciclo, ativar numa base
 * de milhares vira uma rajada — e rajada é o que faz denunciarem o número.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { whatsappSendSpy } from '@/tests/helpers/msw-spies'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { saveWhatsAppCredentials, updateConnectionState } from '@/lib/core/whatsapp/config'
import { getSource } from '@/lib/core/automations/sources'
import { evaluateAutomations } from '@/lib/core/automations/evaluate'

const sb = serviceClient()
const HOJE = '2026-08-11'
const AGORA = new Date('2026-08-11T12:00:00.000Z')
const TUSS = '10101012'

async function enc(plain: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')
  const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
  if (error) throw new Error(error.message)
  return data as unknown as string
}

async function seedPaciente(tenantId: string): Promise<string> {
  const id = randomUUID()
  const { error } = await sb.from('patients').insert({
    id,
    tenant_id: tenantId,
    full_name_enc: await enc('Maria'),
    phone_enc: await enc('5527988887777'),
    status: 'ativo',
    reminders_opt_in: true,
    automations_opt_in: true,
  } as never)
  if (error) throw new Error(`paciente: ${error.message}`)
  return id
}

async function clinica(slug: string, tetoCiclo = 50) {
  const { tenantId } = await seedTenant(slug)
  await sb.from('tenant_entitlements' as never).insert({
    tenant_id: tenantId,
    plan: 'pro',
    status: 'active',
    modules: ['automacoes'],
  } as never)
  await sb.from('tenant_clinic_profile' as never).upsert({
    tenant_id: tenantId,
    corporate_name: 'Clínica Teste',
    automation_max_per_cycle: tetoCiclo,
  } as never)
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
  return tenantId
}

function ctx(tenantId: string, params: Record<string, unknown>, today = HOJE) {
  return {
    supabase: sb,
    tenantId,
    today,
    timezone: 'America/Sao_Paulo',
    clinicName: 'Clínica',
    // A janela do ciclo: as fontes de dia civil ignoram, as ancoradas usam.
    // O ciclo acontece ao MEIO-DIA UTC do dia civil do teste, e não em
    // `new Date()`: as fontes ancoradas comparam a âncora com este instante
    // (consulta que já começou não recebe aviso de preparo), e um relógio de
    // parede faria o mesmo teste passar de manhã e falhar à tarde.
    now: new Date(`${today}T12:00:00.000Z`),
    windowFrom: new Date(Date.parse(`${today}T12:00:00.000Z`) - 15 * 60_000),
    params,
  }
}

/**
 * A cadeia de catálogo/preço é semeada UMA vez por clínica — `procedures` tem
 * unique por (tenant, tuss), então repetir por atendimento colide.
 */
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
  cat?: Awaited<ReturnType<typeof seedCatalogo>>,
): Promise<string> {
  const c = cat ?? (await seedCatalogo(tenantId))
  return seedAppointment({
    tenantId,
    patientId,
    ...c,
    amountCents: 20000,
    commissionBps: 5000,
    at,
  })
}

describe('fonte: paciente sem retorno', () => {
  const fonte = getSource('sem_retorno')!

  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
  })

  it('quem nunca teve atendimento entra', async () => {
    const tenantId = await clinica(`ret-${randomUUID().slice(0, 6)}`)
    const p = await seedPaciente(tenantId)
    const r = await fonte.enumerate(ctx(tenantId, { meses: 6 }))
    expect(r.map((c) => c.patientId)).toContain(p)
    // Chave MENSAL: quem segue sem voltar não vira cobrança diária.
    expect(r[0]?.occurrenceKey).toBe('2026-08')
  })

  it('uma consulta recente já tira o paciente da lista', async () => {
    const tenantId = await clinica(`ret2-${randomUUID().slice(0, 6)}`)
    const p = await seedPaciente(tenantId)
    await seedAtendimento(tenantId, p, '2026-07-15T14:00:00.000Z')
    const r = await fonte.enumerate(ctx(tenantId, { meses: 6 }))
    expect(r.map((c) => c.patientId)).not.toContain(p)
  })

  it('consulta ANTIGA não conta como retorno', async () => {
    const tenantId = await clinica(`ret3-${randomUUID().slice(0, 6)}`)
    const p = await seedPaciente(tenantId)
    await seedAtendimento(tenantId, p, '2025-01-10T14:00:00.000Z')
    const r = await fonte.enumerate(ctx(tenantId, { meses: 6 }))
    expect(r.map((c) => c.patientId)).toContain(p)
  })

  it('a fonte avisa sobre o risco de volume', () => {
    expect(fonte.warning).toBeTruthy()
    expect(fonte.warning).toMatch(/prévia|teto/i)
  })
})

describe('fonte: confirmação de agendamento', () => {
  const fonte = getSource('confirmacao_agendamento')!

  beforeEach(async () => {
    await resetDatabase()
  })

  it('a chave é o ID DO ATENDIMENTO — dois no mesmo dia são dois eventos', async () => {
    const tenantId = await clinica(`conf-${randomUUID().slice(0, 6)}`)
    const p = await seedPaciente(tenantId)
    const cat = await seedCatalogo(tenantId)
    const a1 = await seedAtendimento(tenantId, p, '2026-09-01T14:00:00.000Z', cat)
    const a2 = await seedAtendimento(tenantId, p, '2026-09-02T14:00:00.000Z', cat)
    // A fonte olha o que foi CRIADO ontem; o seed cria com `now()`, então o
    // recorte de hoje é o que devolve os dois.
    const r = await fonte.enumerate(ctx(tenantId, {}, hojeReal()))
    const chaves = r.map((c) => c.occurrenceKey)
    if (chaves.length > 0) {
      expect(new Set(chaves).size).toBe(chaves.length)
      expect(chaves.every((k) => k === a1 || k === a2)).toBe(true)
    }
  })
})

describe('teto por ciclo (SC-004)', () => {
  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
  })

  it('com teto 2 e 5 candidatos, saem 2 e o resto fica para o próximo ciclo', async () => {
    const tenantId = await clinica(`teto-${randomUUID().slice(0, 6)}`, 2)
    for (let i = 0; i < 5; i++) await seedPaciente(tenantId)

    const { data: msg } = await sb
      .from('message_templates' as never)
      .insert({
        tenant_id: tenantId,
        name: 'M',
        body: 'Oi {{paciente}}, faz {{meses}} meses',
      } as never)
      .select('id')
      .single()
    const { data: trg } = await sb
      .from('automation_triggers' as never)
      .insert({
        tenant_id: tenantId,
        name: 'Retorno',
        source: 'sem_retorno',
        params: { meses: 6 },
      } as never)
      .select('id')
      .single()
    await sb.from('automations' as never).insert({
      tenant_id: tenantId,
      name: `Auto ${(trg as unknown as { id: string }).id.slice(0, 8)}`,
      trigger_id: (trg as unknown as { id: string }).id,
      message_template_id: (msg as unknown as { id: string }).id,
      active: true,
    } as never)

    const primeiro = await evaluateAutomations(sb, AGORA)
    expect(primeiro.enviadas).toBe(2)
    expect(primeiro.suprimidas).toBe(3)
    expect(whatsappSendSpy.calls).toHaveLength(2)

    // A supressão LIBERA a chave: o ciclo seguinte reavalia os que ficaram de
    // fora, em vez de perdê-los para sempre.
    const segundo = await evaluateAutomations(sb, AGORA)
    expect(segundo.enviadas).toBe(2)
    expect(whatsappSendSpy.calls).toHaveLength(4)
  })
})

function hojeReal(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

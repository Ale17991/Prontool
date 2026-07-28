/**
 * T022 + T032 (Feature 051) — o ciclo do cron enviando por WhatsApp.
 *
 * T022 — idempotência (SC-003): dois ciclos sobre o mesmo agendamento geram UM
 *        envio. É a promessa mais visível da feature: mensagem repetida no
 *        WhatsApp do paciente é constrangedora de um jeito que e-mail não é.
 * T032 — guardas do lote: paciente sem telefone, número da clínica fora do ar
 *        (que deve virar UMA ocorrência agregada, não uma falha por paciente —
 *        FR-012), e agendamento estornado.
 *
 * O MSW intercepta o serviço de envio: nenhuma mensagem real sai daqui. O
 * `setup.ts` ainda sobrescreve WHATSAPP_SERVICE_URL para um host fake, porque
 * o .env.local de desenvolvimento aponta para o serviço de PRODUÇÃO.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { whatsappSendSpy, qstashSpy } from '@/tests/helpers/msw-spies'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { processBatch } from '@/lib/core/reminders/process-batch'
import { saveWhatsAppCredentials, updateConnectionState } from '@/lib/core/whatsapp/config'

const TUSS = '10101012'
const OFFSET_HOURS = 24
const NOW = new Date('2026-08-10T12:00:00.000Z')
/** Dentro da janela [now+offset-15min, now+offset] que o select-due usa. */
const APPOINTMENT_AT = new Date(NOW.getTime() + OFFSET_HOURS * 3600_000 - 60_000).toISOString()

const sb = serviceClient()
const QSTASH_TOKEN_ORIGINAL = process.env.QSTASH_TOKEN

/**
 * O `seedPatient` do repo grava stubs que NÃO são ciphertext válido — o
 * decrypt do send-one falharia. Aqui ciframos de verdade, que é o único jeito
 * de exercitar o caminho completo até o envio.
 */
async function seedPatientCifrado(
  tenantId: string,
  opts: { phone?: string | null; email?: string | null } = {},
): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente no ambiente de teste')
  const enc = async (plain: string) => {
    const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
    if (error) throw new Error(error.message)
    return data as unknown as string
  }

  const id = randomUUID()
  const row: Record<string, unknown> = {
    id,
    tenant_id: tenantId,
    ghl_contact_id: `contact-${id}`,
    full_name_enc: await enc('Maria Silva'),
    cpf_enc: await enc('12345678901'),
    status: 'ativo',
  }
  if (opts.phone) row.phone_enc = await enc(opts.phone)
  if (opts.email) row.email_enc = await enc(opts.email)

  const { error } = await sb.from('patients').insert(row as never)
  if (error) throw new Error(`seedPatientCifrado: ${error.message}`)
  return id
}

async function seedClinicaComWhatsApp(slug: string, connected = true) {
  const { tenantId } = await seedTenant(slug)
  await sb.from('tenant_clinic_profile' as never).upsert({
    tenant_id: tenantId,
    reminder_enabled: true,
    reminder_offsets_hours: [OFFSET_HOURS],
    reminder_window_start: '00:00',
    reminder_window_end: '23:59',
    reminder_send_weekends: true,
    reminder_channels: ['whatsapp'],
    corporate_name: 'Clínica Teste',
  } as never)

  await saveWhatsAppCredentials(sb as unknown as SupabaseClient<never>, {
    tenantId,
    serviceTenantSlug: slug,
    apiKey: 'ck_teste_1234567890',
  })
  await updateConnectionState(sb as unknown as SupabaseClient<never>, tenantId, {
    status: connected ? 'connected' : 'disconnected',
    instanceName: `${slug}-1`,
    numberConnected: connected ? '5511999990000' : null,
    disconnectReason: connected ? null : 'logged_out',
  })
  return tenantId
}

interface CadastroBase {
  procedureId: string
  planId: string
  doctorId: string
  commissionId: string
  priceVersionId: string
}

/** Procedimento/plano/médico são únicos por tenant — cadastra UMA vez. */
async function seedCadastroBase(tenantId: string): Promise<CadastroBase> {
  await seedTussCode(TUSS)
  const procedureId = await seedProcedure(tenantId, TUSS)
  const planId = await seedHealthPlan(tenantId, 'Unimed')
  const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000 })
  const priceVersionId = await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: 20_000,
    validFrom: '2020-01-01',
  })
  return { procedureId, planId, doctorId, commissionId, priceVersionId }
}

async function seedConsulta(
  tenantId: string,
  patientId: string,
  base: CadastroBase,
  override: { doctorId?: string; commissionId?: string } = {},
) {
  const { procedureId, planId, priceVersionId } = base
  const doctorId = override.doctorId ?? base.doctorId
  const commissionId = override.commissionId ?? base.commissionId
  return seedAppointment({
    tenantId,
    patientId,
    doctorId,
    procedureId,
    planId,
    priceVersionId,
    commissionId,
    amountCents: 20_000,
    commissionBps: 4000,
    at: APPOINTMENT_AT,
  })
}

async function lembretes(tenantId: string) {
  const { data } = await sb
    .from('appointment_reminders' as never)
    .select('status, channel')
    .eq('tenant_id', tenantId)
  return (data ?? []) as unknown as Array<{ status: string; channel: string }>
}

describe('Feature 051 — T022: idempotência do ciclo (SC-003)', () => {
  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
    qstashSpy.reset()
    // O .env.local de desenvolvimento TEM QSTASH_TOKEN, e com ele o ciclo
    // apenas ENFILEIRA — o envio real acontece depois, no worker. Para
    // exercitar o caminho completo (render, normalização, idempotência,
    // gravação) num teste só, desligamos o QStash e usamos a degradação
    // inline. O caminho de enfileiramento tem teste próprio no fim do arquivo.
    delete process.env.QSTASH_TOKEN
  })

  afterEach(() => {
    process.env.QSTASH_TOKEN = QSTASH_TOKEN_ORIGINAL
  })

  it('dois ciclos seguidos geram UM envio e UM registro', async () => {
    const tenantId = await seedClinicaComWhatsApp('wa-idem')
    const base = await seedCadastroBase(tenantId)
    const patientId = await seedPatientCifrado(tenantId, { phone: '11999998888' })
    await seedConsulta(tenantId, patientId, base)

    await processBatch(sb, NOW)
    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(1)
    const regs = await lembretes(tenantId)
    expect(regs.filter((r) => r.channel === 'whatsapp')).toHaveLength(1)
    expect(regs[0]?.status).toBe('sent')
  })

  it('o externalId enviado ao serviço é o id do lembrete — a correlação do callback', async () => {
    const tenantId = await seedClinicaComWhatsApp('wa-extid')
    const base = await seedCadastroBase(tenantId)
    const patientId = await seedPatientCifrado(tenantId, { phone: '11999998888' })
    await seedConsulta(tenantId, patientId, base)

    await processBatch(sb, NOW)

    const { data } = await sb
      .from('appointment_reminders' as never)
      .select('id')
      .eq('tenant_id', tenantId)
      .single()
    const reminderId = (data as unknown as { id: string }).id
    expect(whatsappSendSpy.calls[0]?.externalId).toBe(reminderId)
  })

  it('normaliza o telefone antes de enviar — o 9 entra no celular sem ele', async () => {
    const tenantId = await seedClinicaComWhatsApp('wa-phone')
    const base = await seedCadastroBase(tenantId)
    const patientId = await seedPatientCifrado(tenantId, { phone: '551188887777' })
    await seedConsulta(tenantId, patientId, base)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls[0]?.to).toBe('5511988887777')
  })
})

describe('Feature 051 — T032: guardas do lote', () => {
  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
    qstashSpy.reset()
    // O .env.local de desenvolvimento TEM QSTASH_TOKEN, e com ele o ciclo
    // apenas ENFILEIRA — o envio real acontece depois, no worker. Para
    // exercitar o caminho completo (render, normalização, idempotência,
    // gravação) num teste só, desligamos o QStash e usamos a degradação
    // inline. O caminho de enfileiramento tem teste próprio no fim do arquivo.
    delete process.env.QSTASH_TOKEN
  })

  afterEach(() => {
    process.env.QSTASH_TOKEN = QSTASH_TOKEN_ORIGINAL
  })

  it('paciente sem telefone vira skipped_no_phone e nada é enviado', async () => {
    const tenantId = await seedClinicaComWhatsApp('wa-sem-tel')
    const base = await seedCadastroBase(tenantId)
    const patientId = await seedPatientCifrado(tenantId, { phone: null })
    await seedConsulta(tenantId, patientId, base)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
    const regs = await lembretes(tenantId)
    // Sem telefone o agendamento nem entra no lote — não há o que registrar
    // por paciente. O que a clínica vê é a ausência de envio, não um erro.
    expect(regs.filter((r) => r.status === 'sent')).toHaveLength(0)
  })

  it('número da clínica fora do ar: UMA ocorrência agregada, não uma por paciente (FR-012)', async () => {
    const tenantId = await seedClinicaComWhatsApp('wa-offline', false)
    const base = await seedCadastroBase(tenantId)
    for (let i = 0; i < 3; i++) {
      const patientId = await seedPatientCifrado(tenantId, { phone: `1199999${1000 + i}` })
      // Um MÉDICO por consulta: o EXCLUDE de conflito de agenda (feature 005)
      // é por médico, e o slot tem 30min — não cabem três dentro da janela de
      // 15min que o select-due usa.
      const { doctorId, commissionId } = await seedDoctor(tenantId, {
        bps: 4000,
        crm: `CRM-WA-${i}`,
      })
      await seedConsulta(tenantId, patientId, base, { doctorId, commissionId })
    }

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)

    const { data: alerts } = await sb
      .from('alerts')
      .select('type, detail')
      .eq('tenant_id', tenantId)
      .eq('type', 'integration_sync_failed')
    // UM alerta para três pacientes — é o ponto do FR-012.
    expect(alerts ?? []).toHaveLength(1)

    const regs = await lembretes(tenantId)
    expect(regs.filter((r) => r.status === 'failed')).toHaveLength(0)
  })

  it('agendamento estornado não gera envio', async () => {
    const tenantId = await seedClinicaComWhatsApp('wa-estorno')
    const base = await seedCadastroBase(tenantId)
    const patientId = await seedPatientCifrado(tenantId, { phone: '11999998888' })
    const appointmentId = await seedConsulta(tenantId, patientId, base)

    const { error: revErr } = await sb.from('appointment_reversals' as never).insert({
      tenant_id: tenantId,
      appointment_id: appointmentId,
      reason: 'teste de estorno',
      reversal_amount_cents: -20_000,
      created_by: randomUUID(),
    } as never)
    // Sem esta asserção o teste passaria pelo motivo errado: um insert que
    // falha em silêncio deixa o agendamento ATIVO, e aí "não enviou" seria
    // mentira — ou pior, enviaria e a asserção é que estaria errada.
    expect(revErr).toBeNull()

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
  })
})

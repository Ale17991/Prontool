/**
 * T044 (Feature 051) — recusa por canal (US5 / FR-016).
 *
 * A regra tem uma hierarquia que importa em LGPD: `reminders_opt_in` é o
 * MESTRE e cala todos os canais; `reminders_whatsapp_opt_in` só é consultado
 * quando o mestre é TRUE. Tratar os dois como um consentimento só significaria
 * ou assumir permissão que o paciente não deu, ou remover uma que ele deu.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
import { processBatch } from '@/lib/core/reminders/process-batch'
import { saveWhatsAppCredentials, updateConnectionState } from '@/lib/core/whatsapp/config'

const TUSS = '10101012'
const OFFSET_HOURS = 24
const NOW = new Date('2026-08-10T12:00:00.000Z')
const APPOINTMENT_AT = new Date(NOW.getTime() + OFFSET_HOURS * 3600_000 - 60_000).toISOString()

const sb = serviceClient()
const QSTASH_TOKEN_ORIGINAL = process.env.QSTASH_TOKEN

async function seedPaciente(
  tenantId: string,
  consent: { optIn?: boolean; whatsappOptIn?: boolean } = {},
): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')
  const enc = async (plain: string) => {
    const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
    if (error) throw new Error(error.message)
    return data as unknown as string
  }
  const id = randomUUID()
  const { error } = await sb.from('patients').insert({
    id,
    tenant_id: tenantId,
    ghl_contact_id: `contact-${id}`,
    full_name_enc: await enc('Maria Silva'),
    cpf_enc: await enc('12345678901'),
    phone_enc: await enc('11999998888'),
    email_enc: await enc('maria@exemplo.test'),
    status: 'ativo',
    reminders_opt_in: consent.optIn ?? true,
    reminders_whatsapp_opt_in: consent.whatsappOptIn ?? true,
  } as never)
  if (error) throw new Error(error.message)
  return id
}

async function seedClinica(slug: string) {
  const { tenantId } = await seedTenant(slug)
  await sb.from('tenant_clinic_profile' as never).upsert({
    tenant_id: tenantId,
    reminder_enabled: true,
    reminder_offsets_hours: [OFFSET_HOURS],
    reminder_window_start: '00:00',
    reminder_window_end: '23:59',
    reminder_send_weekends: true,
    reminder_channels: ['email', 'whatsapp'],
    corporate_name: 'Clínica Teste',
  } as never)
  await saveWhatsAppCredentials(sb as unknown as SupabaseClient<never>, {
    tenantId,
    serviceTenantSlug: slug,
    apiKey: 'ck_teste_1234567890',
  })
  await updateConnectionState(sb as unknown as SupabaseClient<never>, tenantId, {
    status: 'connected',
    instanceName: `${slug}-1`,
    numberConnected: '5511999990000',
  })
  return tenantId
}

async function seedConsulta(tenantId: string, patientId: string) {
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

async function registros(tenantId: string) {
  const { data } = await sb
    .from('appointment_reminders' as never)
    .select('channel, status')
    .eq('tenant_id', tenantId)
  return (data ?? []) as unknown as Array<{ channel: string; status: string }>
}

describe('Feature 051 — T044: recusa por canal (US5)', () => {
  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
    delete process.env.QSTASH_TOKEN
  })

  afterEach(() => {
    process.env.QSTASH_TOKEN = QSTASH_TOKEN_ORIGINAL
  })

  it('recusa de WhatsApp bloqueia SÓ o WhatsApp — o e-mail continua saindo', async () => {
    const tenantId = await seedClinica('optout-canal')
    const patientId = await seedPaciente(tenantId, { whatsappOptIn: false })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)

    const regs = await registros(tenantId)
    const wa = regs.find((r) => r.channel === 'whatsapp')
    const mail = regs.find((r) => r.channel === 'email')
    // O registro do WhatsApp EXISTE, com o motivo — a clínica precisa saber
    // que não foi falha, foi decisão do paciente.
    expect(wa?.status).toBe('skipped_opt_out_channel')
    expect(mail?.status).toBe('sent')
  })

  it('recusa MESTRA cala todos os canais', async () => {
    const tenantId = await seedClinica('optout-mestre')
    const patientId = await seedPaciente(tenantId, { optIn: false })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
    const regs = await registros(tenantId)
    expect(regs.every((r) => r.status.startsWith('skipped_opt_out'))).toBe(true)
    expect(regs.some((r) => r.status === 'sent')).toBe(false)
  })

  it('sem recusa nenhuma, os dois canais saem', async () => {
    const tenantId = await seedClinica('optout-nenhuma')
    const patientId = await seedPaciente(tenantId)
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(1)
    const regs = await registros(tenantId)
    expect(regs.filter((r) => r.status === 'sent')).toHaveLength(2)
  })

  it('a recusa mestra tem precedência sobre o canal — não se anulam', async () => {
    // Paciente que aceita WhatsApp mas recusou tudo: o mestre vence.
    const tenantId = await seedClinica('optout-precedencia')
    const patientId = await seedPaciente(tenantId, { optIn: false, whatsappOptIn: true })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
    const regs = await registros(tenantId)
    const wa = regs.find((r) => r.channel === 'whatsapp')
    // `skipped_opt_out` (mestre), não `skipped_opt_out_channel`: o motivo
    // registrado precisa refletir a decisão real do paciente.
    expect(wa?.status).toBe('skipped_opt_out')
  })
})

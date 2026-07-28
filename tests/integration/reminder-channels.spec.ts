/**
 * T033 (Feature 051) — escolha de canal (US3).
 *
 * Três modos: só e-mail, só WhatsApp, e ambos. Mais o fallback: canal é
 * WhatsApp, paciente não tem telefone, e avisar por e-mail é melhor que não
 * avisar ninguém.
 *
 * O modo "ambos" é o que mais depende do schema estar certo: os dois registros
 * convivem porque o índice de idempotência da 0094 discrimina por canal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { whatsappSendSpy, resendSpy } from '@/tests/helpers/msw-spies'
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

async function seedPatientCifrado(
  tenantId: string,
  opts: { phone?: string | null; email?: string | null },
): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')
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
  if (error) throw new Error(error.message)
  return id
}

async function seedClinica(slug: string, channels: string[], fallback = true) {
  const { tenantId } = await seedTenant(slug)
  await sb.from('tenant_clinic_profile' as never).upsert({
    tenant_id: tenantId,
    reminder_enabled: true,
    reminder_offsets_hours: [OFFSET_HOURS],
    reminder_window_start: '00:00',
    reminder_window_end: '23:59',
    reminder_send_weekends: true,
    reminder_channels: channels,
    reminder_whatsapp_fallback_email: fallback,
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

async function canaisRegistrados(tenantId: string): Promise<string[]> {
  const { data } = await sb
    .from('appointment_reminders' as never)
    .select('channel, status')
    .eq('tenant_id', tenantId)
  return ((data ?? []) as unknown as Array<{ channel: string }>).map((r) => r.channel).sort()
}

describe('Feature 051 — T033: escolha de canal (US3)', () => {
  beforeEach(async () => {
    await resetDatabase()
    whatsappSendSpy.reset()
    resendSpy.reset()
    // Sem QStash o ciclo envia inline — é o que permite observar o disparo.
    delete process.env.QSTASH_TOKEN
  })

  afterEach(() => {
    process.env.QSTASH_TOKEN = QSTASH_TOKEN_ORIGINAL
  })

  it('somente WhatsApp: nenhum e-mail de lembrete sai', async () => {
    const tenantId = await seedClinica('canal-wa', ['whatsapp'])
    const patientId = await seedPatientCifrado(tenantId, {
      phone: '11999998888',
      email: 'maria@exemplo.test',
    })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(1)
    expect(await canaisRegistrados(tenantId)).toEqual(['whatsapp'])
  })

  it('somente e-mail: nada é enviado por WhatsApp', async () => {
    const tenantId = await seedClinica('canal-mail', ['email'])
    const patientId = await seedPatientCifrado(tenantId, {
      phone: '11999998888',
      email: 'maria@exemplo.test',
    })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
    expect(await canaisRegistrados(tenantId)).toEqual(['email'])
  })

  it('ambos: um registro POR CANAL para o mesmo agendamento e offset', async () => {
    const tenantId = await seedClinica('canal-ambos', ['email', 'whatsapp'])
    const patientId = await seedPatientCifrado(tenantId, {
      phone: '11999998888',
      email: 'maria@exemplo.test',
    })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    // É o caso que prova o índice parcial da 0094 discriminando por canal.
    expect(await canaisRegistrados(tenantId)).toEqual(['email', 'whatsapp'])
    expect(whatsappSendSpy.calls).toHaveLength(1)
  })

  it('fallback: canal WhatsApp, paciente sem telefone, avisa por e-mail', async () => {
    const tenantId = await seedClinica('canal-fallback', ['whatsapp'], true)
    const patientId = await seedPatientCifrado(tenantId, {
      phone: null,
      email: 'maria@exemplo.test',
    })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
    expect(await canaisRegistrados(tenantId)).toEqual(['email'])
  })

  it('fallback desligado: sem telefone, ninguém é avisado', async () => {
    const tenantId = await seedClinica('canal-sem-fallback', ['whatsapp'], false)
    const patientId = await seedPatientCifrado(tenantId, {
      phone: null,
      email: 'maria@exemplo.test',
    })
    await seedConsulta(tenantId, patientId)

    await processBatch(sb, NOW)

    expect(whatsappSendSpy.calls).toHaveLength(0)
    expect(await canaisRegistrados(tenantId)).toEqual([])
  })
})

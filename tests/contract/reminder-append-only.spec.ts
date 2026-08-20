/**
 * T023 (Feature 051) — invariantes de `appointment_reminders` depois da 0185.
 *
 * A 0185 expandiu o CHECK de status e o trigger de transição. Este teste existe
 * porque a alternativa considerada (e rejeitada) era relaxar o trigger para
 * acomodar 'delivered'/'read' — o que enfraqueceria uma garantia de
 * imutabilidade já existente. Aqui provamos que ela continua de pé.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'

const TUSS = '10101012'

describe('Feature 051 — appointment_reminders continua append-only', () => {
  let tenantId: string
  let appointmentId: string
  const sb = serviceClient()

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('reminder-append-only')).tenantId
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
    const patientId = await seedPatient(tenantId)
    appointmentId = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 20_000,
      commissionBps: 4000,
    })
  })

  async function novoLembrete(status = 'queued', offset = 24, channel = 'whatsapp') {
    const { data, error } = await sb
      .from('appointment_reminders' as never)
      .insert({
        tenant_id: tenantId,
        appointment_id: appointmentId,
        scheduled_offset_hours: offset,
        channel,
        status,
        is_manual: true, // evita o unique parcial do cron entre os casos
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as unknown as { id: string }).id
  }

  const novos = ['skipped_no_phone', 'skipped_no_connection', 'skipped_opt_out_channel']

  it.each(novos)('aceita %s como destino de queued →', async (status) => {
    const id = await novoLembrete()
    const { error } = await sb
      .from('appointment_reminders' as never)
      .update({ status } as never)
      .eq('id', id)
    expect(error).toBeNull()
  })

  it.each(novos)('%s é aceito também no INSERT direto', async (status) => {
    await expect(novoLembrete(status)).resolves.toBeTruthy()
  })

  it('recusa status fora do domínio', async () => {
    await expect(novoLembrete('status_inventado')).rejects.toThrow()
  })

  it('NÃO permite transição a partir de estado terminal', async () => {
    const id = await novoLembrete()
    await sb
      .from('appointment_reminders' as never)
      .update({ status: 'sent' } as never)
      .eq('id', id)

    const { error } = await sb
      .from('appointment_reminders' as never)
      .update({ status: 'failed' } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('NÃO permite DELETE', async () => {
    const id = await novoLembrete()
    const { error } = await sb
      .from('appointment_reminders' as never)
      .delete()
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('e-mail e WhatsApp do MESMO agendamento/offset convivem — é o que o modo "ambos" precisa', async () => {
    const base = {
      tenant_id: tenantId,
      appointment_id: appointmentId,
      scheduled_offset_hours: 48,
      status: 'queued',
      is_manual: false,
    }
    const a = await sb
      .from('appointment_reminders' as never)
      .insert({ ...base, channel: 'email' } as never)
    const b = await sb
      .from('appointment_reminders' as never)
      .insert({ ...base, channel: 'whatsapp' } as never)
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()

    // Mas o MESMO canal repetido colide — é a idempotência do cron (SC-003).
    const c = await sb
      .from('appointment_reminders' as never)
      .insert({ ...base, channel: 'whatsapp' } as never)
    expect(c.error).not.toBeNull()
  })
})

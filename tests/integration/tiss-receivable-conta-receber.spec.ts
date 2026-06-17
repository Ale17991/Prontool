/**
 * Feature 029 (US6/T052) — conta a receber e conciliação por lote.
 *
 * Um lote (faturado = soma das guias) recebe um pagamento parcial → fica
 * pendente; ao completar o valor, as guias `exportada` viram `paga`. O repasse
 * NÃO é tocado (decisão: comissão permanece sobre o faturado).
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedDoctor,
  seedProcedure,
  seedTussCode,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { recordLotePayment } from '@/lib/core/tiss/receivables'

const AMOUNT = 25000

async function seedPatient(sb: SupabaseClient, tenantId: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY as string
  const { data } = await sb.rpc('enc_text_with_key', { plain: 'Maria', key })
  const id = randomUUID()
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: `contact-${id}`,
      full_name_enc: data as unknown as string,
      cpf_enc: data as unknown as string,
    })
    .throwOnError()
  return id
}

async function setupLoteWithGuia() {
  const sb = serviceClient()
  const { tenantId } = await seedTenant('tiss-receber')
  const admin = await seedUser(tenantId, 'admin')
  const planId = await seedHealthPlan(tenantId, 'Operadora TISS')
  await seedTussCode('10101012')
  const procedureId = await seedProcedure(tenantId, '10101012')
  const priceVersionId = await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: AMOUNT,
    validFrom: '2020-01-01',
  })
  const { doctorId, commissionId } = await seedDoctor(tenantId)
  const patientId = await seedPatient(sb, tenantId)
  const appointmentId = await seedAppointment({
    tenantId,
    patientId,
    doctorId,
    procedureId,
    planId,
    priceVersionId,
    commissionId,
    amountCents: AMOUNT,
    commissionBps: 4000,
    at: '2026-06-09T13:00:00.000Z',
  })

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY as string
  const { data: enc } = await sb.rpc('enc_text_with_key', { plain: '{}', key })

  const { data: lote } = await sb
    .from('tiss_lotes')
    .insert({
      tenant_id: tenantId,
      health_plan_id: planId,
      lote_number: '1',
      status: 'fechado',
      created_by_user_id: admin.userId,
    })
    .select('id')
    .single()
    .throwOnError()

  const { data: guia } = await sb
    .from('tiss_guias')
    .insert({
      tenant_id: tenantId,
      health_plan_id: planId,
      appointment_id: appointmentId,
      guia_type: 'consulta',
      guia_number_prestador: '000001',
      beneficiary_snapshot_enc: enc as unknown as string,
      executante_snapshot: {} as never,
      frozen_amount_cents: AMOUNT,
      status: 'exportada',
      lote_id: lote!.id,
      created_by_user_id: admin.userId,
    })
    .select('id')
    .single()
    .throwOnError()

  return { sb, tenantId, loteId: lote!.id, guiaId: guia!.id, actorUserId: admin.userId }
}

describe('Feature 029 — conta a receber e conciliação (US6)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('T052 — recebimento parcial fica pendente; total marca guias como paga', async () => {
    const { sb, tenantId, loteId, guiaId, actorUserId } = await setupLoteWithGuia()

    const partial = await recordLotePayment({
      supabase: sb,
      tenantId,
      loteId,
      amountCents: 10000,
      actorUserId,
      actorLabel: 'test',
    })
    expect(partial.billedCents).toBe(AMOUNT)
    expect(partial.receivedCents).toBe(10000)
    expect(partial.pendingCents).toBe(15000)
    expect(partial.fullyPaid).toBe(false)

    // Guia ainda exportada.
    const { data: g1 } = await sb.from('tiss_guias').select('status').eq('id', guiaId).single()
    expect(g1?.status).toBe('exportada')

    const full = await recordLotePayment({
      supabase: sb,
      tenantId,
      loteId,
      amountCents: 15000,
      actorUserId,
      actorLabel: 'test',
    })
    expect(full.receivedCents).toBe(AMOUNT)
    expect(full.fullyPaid).toBe(true)

    // Guia agora paga.
    const { data: g2 } = await sb.from('tiss_guias').select('status').eq('id', guiaId).single()
    expect(g2?.status).toBe('paga')
  })
})

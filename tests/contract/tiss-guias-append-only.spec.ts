/**
 * T013 (Feature 029) — Princípio I: tabelas de faturamento TISS são append-only.
 *
 * - tiss_guias: DELETE bloqueado; UPDATE fora da whitelist (guia_number_prestador)
 *   bloqueado; UPDATE na whitelist (status) permitido.
 * - tiss_lotes: DELETE bloqueado; UPDATE na whitelist (status) permitido.
 * - tiss_guia_procedures e tiss_glosas: DELETE bloqueado (imutáveis).
 *
 * Testa via service_role (bypassa RLS, mas NÃO bypassa triggers).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedDoctor,
  seedPatient,
  seedProcedure,
  seedTussCode,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'

describe('Feature 029 — append-only das tabelas de faturamento TISS', () => {
  let tenantId: string
  let userId: string
  let planId: string
  let guiaId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tiss-appendonly')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    userId = admin.userId
    planId = await seedHealthPlan(tenantId, 'Operadora Teste')

    // Grafo mínimo de atendimento para a guia (appointment_id é NOT NULL).
    await seedTussCode('10101012', { tussTable: '22' })
    const procedureId = await seedProcedure(tenantId, '10101012')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 15000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const appointmentId = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 15000,
      commissionBps: 4000,
    })

    const sb = serviceClient()
    guiaId = randomUUID()
    await sb
      .from('tiss_guias' as never)
      .insert({
        id: guiaId,
        tenant_id: tenantId,
        health_plan_id: planId,
        appointment_id: appointmentId,
        guia_type: 'consulta',
        guia_number_prestador: 'G-0001',
        beneficiary_snapshot_enc: Buffer.from('stub') as unknown as string,
        frozen_amount_cents: 15000,
        created_by_user_id: userId,
      } as never)
      .throwOnError()
  })

  it('tiss_guias: DELETE é bloqueado', async () => {
    const sb = serviceClient()
    const res = await sb.from('tiss_guias' as never).delete().eq('id', guiaId)
    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/DELETE not allowed|append-only/i)
  })

  it('tiss_guias: UPDATE fora da whitelist (guia_number_prestador) é bloqueado', async () => {
    const sb = serviceClient()
    const res = await sb
      .from('tiss_guias' as never)
      .update({ guia_number_prestador: 'G-9999' } as never)
      .eq('id', guiaId)
    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/append-only|Column.*guia_number_prestador/i)
  })

  it('tiss_guias: UPDATE na whitelist (status) é permitido', async () => {
    const sb = serviceClient()
    const res = await sb
      .from('tiss_guias' as never)
      .update({ status: 'pronta' } as never)
      .eq('id', guiaId)
    expect(res.error).toBeNull()
  })

  it('tiss_guia_procedures: DELETE é bloqueado', async () => {
    const sb = serviceClient()
    const lineId = randomUUID()
    await sb
      .from('tiss_guia_procedures' as never)
      .insert({
        id: lineId,
        tenant_id: tenantId,
        guia_id: guiaId,
        sequence: 1,
        tuss_table: '22',
        procedure_code: '10101012',
        description: 'Consulta',
        quantity: 1,
        unit_amount_cents: 15000,
        total_amount_cents: 15000,
      } as never)
      .throwOnError()
    const res = await sb.from('tiss_guia_procedures' as never).delete().eq('id', lineId)
    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/DELETE not allowed|append-only/i)
  })

  it('tiss_lotes: DELETE bloqueado; UPDATE na whitelist (status) permitido', async () => {
    const sb = serviceClient()
    const loteId = randomUUID()
    await sb
      .from('tiss_lotes' as never)
      .insert({
        id: loteId,
        tenant_id: tenantId,
        health_plan_id: planId,
        lote_number: 'L-0001',
        created_by_user_id: userId,
      } as never)
      .throwOnError()

    const upd = await sb
      .from('tiss_lotes' as never)
      .update({ status: 'fechado' } as never)
      .eq('id', loteId)
    expect(upd.error).toBeNull()

    const del = await sb.from('tiss_lotes' as never).delete().eq('id', loteId)
    expect(del.error).toBeTruthy()
    expect(del.error?.message).toMatch(/DELETE not allowed|append-only/i)
  })

  it('tiss_glosas: DELETE é bloqueado', async () => {
    const sb = serviceClient()
    const glosaId = randomUUID()
    await sb
      .from('tiss_glosas' as never)
      .insert({
        id: glosaId,
        tenant_id: tenantId,
        guia_id: guiaId,
        motivo_code: '1001',
        motivo_text: 'Número da carteira inválido',
        glosado_amount_cents: 15000,
        created_by_user_id: userId,
      } as never)
      .throwOnError()
    const res = await sb.from('tiss_glosas' as never).delete().eq('id', glosaId)
    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/DELETE not allowed|append-only/i)
  })
})

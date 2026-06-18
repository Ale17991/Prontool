/**
 * Feature 029 (US3/T043) — geração da Guia de SP/SADT ponta a ponta.
 *
 * Atendimento de convênio com 2 procedimentos → guia `pronta` com 2 linhas
 * em `tiss_guia_procedures` e `frozen_amount_cents` = soma. Sem a carteira do
 * beneficiário → `rascunho` com pendência. A validade XSD do XML SP/SADT é
 * coberta pelo teste-âncora `tiss-render-spsadt-validates`.
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
import { seedAppointmentLineAndComplete } from '@/tests/integration/_helpers/seed-appointment-procedure'
import { generateSpSadtGuia } from '@/lib/core/tiss/build-guia'
import { upsertPatientCard } from '@/lib/core/tiss/patient-cards'

const TUSS_1 = '40304361'
const TUSS_2 = '40301010'
const AMOUNT_1 = 3500
const AMOUNT_2 = 1800

async function seedDecryptablePatient(sb: SupabaseClient, tenantId: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY as string
  const enc = async (plain: string) => {
    const { data } = await sb.rpc('enc_text_with_key', { plain, key })
    return data as unknown as string
  }
  const id = randomUUID()
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: `contact-${id}`,
      full_name_enc: await enc('Maria Teste da Silva'),
      cpf_enc: await enc('39053344705'),
    })
    .throwOnError()
  return id
}

async function setup(slug: string, opts: { withCard: boolean }) {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const planId = await seedHealthPlan(tenantId, 'Operadora TISS')
  await seedTussCode(TUSS_1)
  await seedTussCode(TUSS_2)
  const proc1 = await seedProcedure(tenantId, TUSS_1)
  const proc2 = await seedProcedure(tenantId, TUSS_2)
  const price1 = await seedPriceVersion({
    tenantId,
    procedureId: proc1,
    planId,
    amountCents: AMOUNT_1,
    validFrom: '2020-01-01',
  })
  const price2 = await seedPriceVersion({
    tenantId,
    procedureId: proc2,
    planId,
    amountCents: AMOUNT_2,
    validFrom: '2020-01-01',
  })
  const { doctorId, commissionId } = await seedDoctor(tenantId)
  await sb
    .from('doctors')
    .update({ council_name: 'CRM', council_number: '123456', council_state: 'SP', cbo: '225125' })
    .eq('id', doctorId)
    .throwOnError()
  const patientId = await seedDecryptablePatient(sb, tenantId)

  await sb
    .from('tenant_tiss_operator_config')
    .insert({
      tenant_id: tenantId,
      health_plan_id: planId,
      ans_registration: '123456',
      contracted_code: 'PREST-001',
      contracted_cnpj: '12345678000199',
      contracted_cnes: '9999999',
      created_by_user_id: admin.userId,
    })
    .throwOnError()

  if (opts.withCard) {
    await upsertPatientCard({
      supabase: sb,
      tenantId,
      patientId,
      healthPlanId: planId,
      cardNumber: '00112233445566',
      actorUserId: admin.userId,
      actorLabel: 'test',
    })
  }

  const appointmentId = await seedAppointment({
    tenantId,
    patientId,
    doctorId,
    procedureId: proc1,
    planId,
    priceVersionId: price1,
    commissionId,
    amountCents: AMOUNT_1,
    commissionBps: 4000,
    at: '2026-06-09T13:00:00.000Z',
  })
  // Linha 1 + completion (ativa o atendimento).
  await seedAppointmentLineAndComplete(sb, {
    tenantId,
    appointmentId,
    procedureId: proc1,
    planId,
    priceVersionId: price1,
    amountCents: AMOUNT_1,
    sequence: 1,
  })
  // Linha 2 (segundo procedimento) — direto, completion já existe.
  await sb
    .from('appointment_procedures')
    .insert({
      tenant_id: tenantId,
      appointment_id: appointmentId,
      procedure_id: proc2,
      plan_id: planId,
      source_price_version_id: price2,
      line_amount_cents: AMOUNT_2,
      vigente_amount_cents: AMOUNT_2,
      amount_was_overridden: false,
      sequence: 2,
      created_by: admin.userId,
    })
    .throwOnError()

  return { sb, tenantId, appointmentId, actorUserId: admin.userId }
}

describe('Feature 029 — gerar Guia de SP/SADT (US3)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('T043 — 2 procedimentos geram guia pronta com 2 linhas e valor somado', async () => {
    const { sb, tenantId, appointmentId, actorUserId } = await setup('tiss-spsadt-ok', {
      withCard: true,
    })

    const result = await generateSpSadtGuia({
      supabase: sb,
      tenantId,
      appointmentId,
      actorUserId,
      actorLabel: 'test',
    })

    expect(result.validationErrors).toEqual([])
    expect(result.status).toBe('pronta')

    const { data: guia } = await sb
      .from('tiss_guias')
      .select('status, guia_type, frozen_amount_cents')
      .eq('id', result.guiaId)
      .single()
    expect(guia?.guia_type).toBe('sp_sadt')
    expect(guia?.frozen_amount_cents).toBe(AMOUNT_1 + AMOUNT_2)

    const { data: lines } = await sb
      .from('tiss_guia_procedures')
      .select('sequence, procedure_code, total_amount_cents')
      .eq('guia_id', result.guiaId)
      .order('sequence', { ascending: true })
    expect(lines).toHaveLength(2)
    expect(lines?.map((l) => l.procedure_code)).toEqual([TUSS_1, TUSS_2])
  })

  it('sem carteira do beneficiário gera rascunho com pendência', async () => {
    const { sb, tenantId, appointmentId, actorUserId } = await setup('tiss-spsadt-incompleta', {
      withCard: false,
    })

    const result = await generateSpSadtGuia({
      supabase: sb,
      tenantId,
      appointmentId,
      actorUserId,
      actorLabel: 'test',
    })

    expect(result.status).toBe('rascunho')
    expect(result.validationErrors.some((e) => e.field === 'numeroCarteira')).toBe(true)
  })
})

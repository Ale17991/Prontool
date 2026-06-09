/**
 * Feature 029 (US2/T024+T025) — geração da Guia de Consulta ponta a ponta.
 *
 * T024: atendimento completo → guia `pronta`; o XML renderizado valida no XSD
 *       04.03.00 oficial (xmllint-wasm).
 * T025: sem a carteira do beneficiário → guia `rascunho` + `validation_errors`
 *       apontando o campo faltante (não entra em lote).
 *
 * Toca o banco local (resetDatabase) — exercita a cadeia real: appointments_
 * effective + appointment_procedures + doctors + paciente decifrado + carteira
 * + config TISS → build-guia → persistência → render → validação XSD.
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
import { generateConsultaGuia } from '@/lib/core/tiss/build-guia'
import { upsertPatientCard } from '@/lib/core/tiss/patient-cards'
import { renderConsultaLoteXml } from '@/lib/core/tiss/xml/render-consulta'
import { validateTissXml } from '@/lib/core/tiss/validate'

const TUSS_CODE = '10101012'
const AMOUNT = 25000

async function seedDecryptablePatient(
  sb: SupabaseClient,
  tenantId: string,
): Promise<string> {
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

/** Monta toda a cadeia necessária para gerar a guia. `withCard` controla T025. */
async function setupAppointment(slug: string, opts: { withCard: boolean }) {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const planId = await seedHealthPlan(tenantId, 'Operadora TISS')
  await seedTussCode(TUSS_CODE)
  const procedureId = await seedProcedure(tenantId, TUSS_CODE)
  const priceVersionId = await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: AMOUNT,
    validFrom: '2020-01-01',
  })
  const { doctorId, commissionId } = await seedDoctor(tenantId)
  // Campos exigidos pela guia TISS (CBO + conselho completo).
  await sb
    .from('doctors')
    .update({ council_name: 'CRM', council_number: '123456', council_state: 'SP', cbo: '225125' })
    .eq('id', doctorId)
    .throwOnError()
  const patientId = await seedDecryptablePatient(sb, tenantId)

  // Config TISS da operadora.
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
    procedureId,
    planId,
    priceVersionId,
    commissionId,
    amountCents: AMOUNT,
    commissionBps: 4000,
    at: '2026-06-09T13:00:00.000Z',
  })
  await seedAppointmentLineAndComplete(sb, {
    tenantId,
    appointmentId,
    procedureId,
    planId,
    priceVersionId,
    amountCents: AMOUNT,
  })

  return { sb, tenantId, appointmentId, actorUserId: admin.userId }
}

describe('Feature 029 — gerar Guia de Consulta (US2)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('T024 — atendimento completo gera guia pronta e XML válido no XSD', async () => {
    const { sb, tenantId, appointmentId, actorUserId } = await setupAppointment('tiss-guia-ok', {
      withCard: true,
    })

    const result = await generateConsultaGuia({
      supabase: sb,
      tenantId,
      appointmentId,
      actorUserId,
      actorLabel: 'test',
    })

    expect(result.validationErrors).toEqual([])
    expect(result.status).toBe('pronta')
    expect(result.model).not.toBeNull()

    // O XML do lote (com esta guia) valida no XSD oficial.
    const xml = renderConsultaLoteXml({
      sequencialTransacao: '1',
      dataRegistro: '2026-06-09',
      horaRegistro: '10:00:00',
      origemCnpj: '12345678000199',
      destinoRegistroANS: '123456',
      numeroLote: '1',
      guias: [result.model!],
      hash: 'placeholder',
    })
    const validation = await validateTissXml(xml)
    expect(validation.errors).toEqual([])
    expect(validation.valid).toBe(true)

    // Persistência: guia pronta + linha de procedimento.
    const { data: guia } = await sb
      .from('tiss_guias')
      .select('status, guia_type, frozen_amount_cents')
      .eq('id', result.guiaId)
      .single()
    expect(guia?.status).toBe('pronta')
    expect(guia?.guia_type).toBe('consulta')
    expect(guia?.frozen_amount_cents).toBe(AMOUNT)

    const { data: lines } = await sb
      .from('tiss_guia_procedures')
      .select('tuss_table, procedure_code')
      .eq('guia_id', result.guiaId)
    expect(lines).toHaveLength(1)
    expect(lines?.[0]?.procedure_code).toBe(TUSS_CODE)
  })

  it('T025 — sem carteira do beneficiário gera rascunho com pendência', async () => {
    const { sb, tenantId, appointmentId, actorUserId } = await setupAppointment(
      'tiss-guia-incompleta',
      { withCard: false },
    )

    const result = await generateConsultaGuia({
      supabase: sb,
      tenantId,
      appointmentId,
      actorUserId,
      actorLabel: 'test',
    })

    expect(result.status).toBe('rascunho')
    expect(result.model).toBeNull()
    expect(result.validationErrors.some((e) => e.field === 'numeroCarteira')).toBe(true)

    const { data: guia } = await sb
      .from('tiss_guias')
      .select('status, validation_errors')
      .eq('id', result.guiaId)
      .single()
    expect(guia?.status).toBe('rascunho')
    expect(Array.isArray(guia?.validation_errors)).toBe(true)
  })
})

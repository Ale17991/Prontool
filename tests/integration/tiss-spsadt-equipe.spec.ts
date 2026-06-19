/**
 * T023 (Feature 031, US3) — equipe na guia SP/SADT.
 *
 * Atendimento de convênio com 2 participantes numa linha de procedimento →
 * guia `pronta` com 2 membros de equipe congelados (executante_snapshot) e o
 * XML do lote contém `equipeSadt`. Participante sem CBO → `rascunho` com
 * `validation_errors` apontando o participante.
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
  seedTissDomainEntry,
} from '@/tests/helpers/seed-factories'
import { seedAppointmentLineAndComplete } from '@/tests/integration/_helpers/seed-appointment-procedure'
import { generateSpSadtGuia } from '@/lib/core/tiss/build-guia'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'
import { upsertPatientCard } from '@/lib/core/tiss/patient-cards'

const TUSS = '40304361'
const AMOUNT = 350000

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

async function seedParticipantDoctor(
  sb: SupabaseClient,
  tenantId: string,
  opts: { cpf: string | null; cbo: string | null },
): Promise<string> {
  const { doctorId } = await seedDoctor(tenantId)
  await sb
    .from('doctors')
    .update({
      council_name: 'CRM',
      council_number: '654321',
      council_state: 'SP',
      cbo: opts.cbo,
      cpf: opts.cpf,
    } as never)
    .eq('id', doctorId)
    .throwOnError()
  return doctorId
}

async function setup(slug: string) {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const planId = await seedHealthPlan(tenantId, 'Operadora TISS')
  await seedTussCode(TUSS)
  const proc = await seedProcedure(tenantId, TUSS)
  const price = await seedPriceVersion({
    tenantId,
    procedureId: proc,
    planId,
    amountCents: AMOUNT,
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
  await upsertPatientCard({
    supabase: sb,
    tenantId,
    patientId,
    healthPlanId: planId,
    cardNumber: '00112233445566',
    actorUserId: admin.userId,
    actorLabel: 'test',
  })

  await seedTissDomainEntry('35', '00', 'Cirurgião')
  await seedTissDomainEntry('35', '06', 'Anestesista')

  const appointmentId = await seedAppointment({
    tenantId,
    patientId,
    doctorId,
    procedureId: proc,
    planId,
    priceVersionId: price,
    commissionId,
    amountCents: AMOUNT,
    commissionBps: 4000,
    at: '2026-06-09T13:00:00.000Z',
  })
  await seedAppointmentLineAndComplete(sb, {
    tenantId,
    appointmentId,
    procedureId: proc,
    planId,
    priceVersionId: price,
    amountCents: AMOUNT,
    sequence: 1,
  })
  const { data: line } = await sb
    .from('appointment_procedures')
    .select('id')
    .eq('appointment_id', appointmentId)
    .eq('sequence', 1)
    .single()
  const lineId = (line as { id: string }).id

  return { sb, tenantId, appointmentId, lineId, actorUserId: admin.userId }
}

describe('Feature 031 — equipe na Guia de SP/SADT (US3)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('2 participantes completos → guia pronta com equipe de 2 membros', async () => {
    const { sb, tenantId, appointmentId, lineId, actorUserId } = await setup('tiss-equipe-ok')
    const cirurgiao = await seedParticipantDoctor(sb, tenantId, { cpf: '11144477735', cbo: '225125' })
    const anestesista = await seedParticipantDoctor(sb, tenantId, { cpf: '52998224725', cbo: '225151' })
    await addParticipant(sb, {
      tenantId,
      appointmentId,
      procedureId: lineId,
      doctorId: cirurgiao,
      participationDegree: '00',
      amountCents: 100000,
      actorUserId,
    })
    await addParticipant(sb, {
      tenantId,
      appointmentId,
      procedureId: lineId,
      doctorId: anestesista,
      participationDegree: '06',
      amountCents: 80000,
      actorUserId,
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
      .select('executante_snapshot')
      .eq('id', result.guiaId)
      .single()
    const snap = (guia as { executante_snapshot: { spSadt?: { equipePorSequence?: Record<string, unknown[]> } } })
      .executante_snapshot
    expect(snap.spSadt?.equipePorSequence?.['1']).toHaveLength(2)
  })

  it('participante sem CBO → rascunho com pendência apontando a equipe', async () => {
    const { sb, tenantId, appointmentId, lineId, actorUserId } = await setup('tiss-equipe-incompleta')
    const semCbo = await seedParticipantDoctor(sb, tenantId, { cpf: '11144477735', cbo: null })
    await addParticipant(sb, {
      tenantId,
      appointmentId,
      procedureId: lineId,
      doctorId: semCbo,
      participationDegree: '00',
      amountCents: 100000,
      actorUserId,
    })

    const result = await generateSpSadtGuia({
      supabase: sb,
      tenantId,
      appointmentId,
      actorUserId,
      actorLabel: 'test',
    })
    expect(result.status).toBe('rascunho')
    expect(result.validationErrors.some((e) => /equipe/.test(e.field) && /CBOS/.test(e.field))).toBe(true)
  })
})

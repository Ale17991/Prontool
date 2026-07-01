/**
 * Feature 029 (US5/T048) — glosa (Tabela 38) e reapresentação.
 *
 * Gera uma guia, marca como `exportada`, registra glosa parcial (motivo válido
 * da Tabela 38) → status `parcial`; motivo fora da Tabela 38 é rejeitado; a
 * reapresentação cria nova guia com `supersedes_guia_id`.
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
import { registerGlosa, reapresentarGuia } from '@/lib/core/tiss/glosa'

const TUSS_CODE = '10101012'
const AMOUNT = 25000

async function seedPatient(sb: SupabaseClient, tenantId: string): Promise<string> {
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
      full_name_enc: await enc('Maria Teste'),
      cpf_enc: await enc('39053344705'),
    })
    .throwOnError()
  return id
}

async function setupExportedGuia() {
  const sb = serviceClient()
  const { tenantId } = await seedTenant('tiss-glosa')
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
  await sb
    .from('doctors')
    .update({ council_name: 'CRM', council_number: '123456', council_state: 'SP', cbo: '225125' })
    .eq('id', doctorId)
    .throwOnError()
  const patientId = await seedPatient(sb, tenantId)

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
  // Domínio 38 (Tabela de glosas) com um motivo válido para o teste.
  await sb
    .from('tiss_domain_tables')
    .upsert(
      {
        domain_number: '38',
        code: '1707',
        description: 'Glosa de teste',
        valid_from: '2000-01-01',
      },
      { onConflict: 'domain_number,code,valid_from' },
    )
    .throwOnError()

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

  const guia = await generateConsultaGuia({
    supabase: sb,
    tenantId,
    appointmentId,
    actorUserId: admin.userId,
    actorLabel: 'test',
  })
  // Simula envio: marca a guia como exportada (transição de status whitelisted).
  await sb.from('tiss_guias').update({ status: 'exportada' }).eq('id', guia.guiaId).throwOnError()

  return { sb, tenantId, guiaId: guia.guiaId, actorUserId: admin.userId }
}

describe('Feature 029 — glosa e reapresentação (US5)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('T048 — glosa parcial muda status para parcial; reapresentação vincula supersedes', async () => {
    const { sb, tenantId, guiaId, actorUserId } = await setupExportedGuia()

    // Motivo fora da Tabela 38 é rejeitado.
    await expect(
      registerGlosa({
        supabase: sb,
        tenantId,
        guiaId,
        motivoCode: '0002',
        motivoText: 'inexistente',
        glosadoAmountCents: 1000,
        actorUserId,
        actorLabel: 'test',
      }),
    ).rejects.toThrow()

    // Glosa parcial válida.
    const result = await registerGlosa({
      supabase: sb,
      tenantId,
      guiaId,
      motivoCode: '1707',
      motivoText: 'Procedimento não autorizado',
      glosadoAmountCents: 10000,
      actorUserId,
      actorLabel: 'test',
    })
    expect(result.guiaStatus).toBe('parcial')

    const { data: guia } = await sb.from('tiss_guias').select('status').eq('id', guiaId).single()
    expect(guia?.status).toBe('parcial')

    // Reapresentação cria nova guia vinculada.
    const reap = await reapresentarGuia({
      supabase: sb,
      tenantId,
      guiaId,
      actorUserId,
      actorLabel: 'test',
    })
    const { data: nova } = await sb
      .from('tiss_guias')
      .select('status, supersedes_guia_id')
      .eq('id', reap.guiaId)
      .single()
    expect(nova?.status).toBe('pronta')
    expect(nova?.supersedes_guia_id).toBe(guiaId)

    const { data: novaLines } = await sb
      .from('tiss_guia_procedures')
      .select('procedure_code')
      .eq('guia_id', reap.guiaId)
    expect(novaLines).toHaveLength(1)
  })
})

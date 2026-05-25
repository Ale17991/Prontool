/**
 * T173 — Anonymization preserves the appointment ledger.
 *
 * After the platform-operator anonymize call (T172), the patient's PII
 * fields decrypt to the placeholder token, but the related atendimentos
 * keep the same `patient_id` and unchanged `frozen_amount_cents`. The
 * `appointments_effective` view still computes correct net values, and
 * `audit_log` carries the retention reason + actor_label.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { upsertPatientFromGhl } from '@/lib/core/patients/upsert-from-ghl'
import { piiRegistry } from '@/tests/helpers/msw-spies'

const TUSS = '10101012'
const TOKEN = 'platform-operator-token-for-tests-32chars-min'

describe('T173 — anonymization preserves appointment ledger', () => {
  beforeEach(async () => {
    await resetDatabase()
    process.env.PLATFORM_OPERATOR_TOKEN = TOKEN
  })

  it('PII becomes the anonymization placeholder, atendimentos unchanged, audit row written', async () => {
    const { tenantId } = await seedTenant('t173')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed T173')
    const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000 })
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 30_000,
      validFrom: '2020-01-01',
    })

    const sb = serviceClient()
    const { patientId } = await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl_t173',
      fullName: 'Maria Identificável',
      cpf: '99988877766',
      phone: '+5511933334444',
      email: 'maria@example.com',
    })
    piiRegistry.register(
      'Maria Identificável',
      '99988877766',
      '+5511933334444',
      'maria@example.com',
    )

    // 3 atendimentos com datas fixas no passado (após o valid_from do preço).
    // O status 'ativo' vem da completion logo abaixo, não da data — datas no
    // passado são só higiene para não depender do relógio.
    const apt1 = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 30_000,
      commissionBps: 4000,
      at: '2024-01-05T10:00:00Z',
    })
    const apt2 = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 30_000,
      commissionBps: 4000,
      at: '2024-02-15T10:00:00Z',
    })
    const apt3 = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 30_000,
      commissionBps: 4000,
      at: '2024-03-25T10:00:00Z',
    })
    const apptIds = [apt1, apt2, apt3]

    // Marca os 3 como realizados. Desde a 0096 a view deriva
    // `effective_status = 'ativo'` a partir de uma linha em
    // `appointment_completions` (antes era por tempo). Sem completion, o
    // atendimento fica 'agendado'.
    await sb
      .from('appointment_completions')
      .insert(
        apptIds.map((appointmentId) => ({
          tenant_id: tenantId,
          appointment_id: appointmentId,
          completed_by: '00000000-0000-0000-0000-000000000001',
          source: 'manual',
          reason: 'seed',
        })),
      )
      .throwOnError()

    const { POST } = await import('@/app/api/platform/patients/[id]/anonymize/route')
    const res = await POST(
      new Request(`http://localhost/api/platform/patients/${patientId}/anonymize`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-operator-token': TOKEN,
        },
        body: JSON.stringify({ tenant_id: tenantId }),
      }),
      { params: { id: patientId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { patientId: string; anonymizedAt: string }
    expect(body.patientId).toBe(patientId)
    expect(body.anonymizedAt).toBeTruthy()

    // (a) Decrypted PII fields return the placeholder token.
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY!
    const { data: decryptedName } = await sb.rpc('dec_text_with_key', {
      cipher: (
        await sb.from('patients').select('full_name_enc').eq('id', patientId).single()
      ).data!.full_name_enc,
      key,
    })
    expect(decryptedName).toBe('[anonimizado]')
    const { data: decryptedCpf } = await sb.rpc('dec_text_with_key', {
      cipher: (
        await sb.from('patients').select('cpf_enc').eq('id', patientId).single()
      ).data!.cpf_enc,
      key,
    })
    expect(decryptedCpf).toBe('[anonimizado]')

    const { data: nullChecks } = await sb
      .from('patients')
      .select('phone_enc, email_enc, birth_date_enc, anonymized_at')
      .eq('id', patientId)
      .single()
    expect(nullChecks?.phone_enc).toBeNull()
    expect(nullChecks?.email_enc).toBeNull()
    expect(nullChecks?.birth_date_enc).toBeNull()
    expect(nullChecks?.anonymized_at).toBeTruthy()

    // (b) Each atendimento still references the same patient_id with
    // unchanged frozen_amount_cents.
    const { data: appts } = await sb
      .from('appointments')
      .select('id, patient_id, frozen_amount_cents, frozen_commission_bps')
      .in('id', apptIds)
      .order('appointment_at', { ascending: true })
    expect(appts).toHaveLength(3)
    for (const a of appts ?? []) {
      expect(a.patient_id).toBe(patientId)
      expect(a.frozen_amount_cents).toBe(30_000)
      expect(a.frozen_commission_bps).toBe(4000)
    }

    // (c) appointments_effective still computes correct net values.
    const { data: effective } = await sb
      .from('appointments_effective')
      .select('id, net_amount_cents, net_commission_cents, effective_status')
      .in('id', apptIds)
    expect(effective).toHaveLength(3)
    for (const e of effective ?? []) {
      expect(e.effective_status).toBe('ativo')
      expect(e.net_amount_cents).toBe(30_000)
      expect(e.net_commission_cents).toBe(12_000)
    }

    // (d) audit_log row records the retention anonymization.
    const { data: audit } = await sb
      .from('audit_log')
      .select('actor_id, actor_label, entity, entity_id, field, reason, result, new_value')
      .eq('tenant_id', tenantId)
      .eq('entity', 'patients')
      .eq('entity_id', patientId)
      .eq('field', 'anonymized_at')
    expect(audit?.length ?? 0).toBeGreaterThan(0)
    const row = audit?.[0]
    expect(row?.actor_id).toBeNull()
    expect(row?.actor_label).toBe('platform-operator')
    expect(row?.reason).toBe('lgpd-retention-anonymization')
    expect(row?.result).toBe('success')
    expect(row?.new_value).toBeTruthy()
  })

  it('rejects calls without a matching X-Platform-Operator-Token (403)', async () => {
    const { tenantId } = await seedTenant('t173-bad-token')
    const sb = serviceClient()
    const { patientId } = await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl_t173_bad',
      fullName: 'Quem',
      cpf: '11122233344',
    })
    piiRegistry.register('11122233344')

    const { POST } = await import('@/app/api/platform/patients/[id]/anonymize/route')
    const res = await POST(
      new Request(`http://localhost/api/platform/patients/${patientId}/anonymize`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-operator-token': 'wrong-token-of-the-correct-length-32chr',
        },
        body: JSON.stringify({ tenant_id: tenantId }),
      }),
      { params: { id: patientId } },
    )
    expect(res.status).toBe(403)

    // Patient untouched.
    const { data: patient } = await sb
      .from('patients')
      .select('anonymized_at')
      .eq('id', patientId)
      .single()
    expect(patient?.anonymized_at).toBeNull()
  })
})

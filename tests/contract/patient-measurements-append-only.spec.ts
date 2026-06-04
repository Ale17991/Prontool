/**
 * T013 (Feature 030) — `patient_measurements` é append-only + coerente.
 *
 * Constitution Principle I (por analogia): medição não se edita nem se
 * apaga — correção é nova linha. Trigger `validate_patient_measurement`
 * rejeita metric_type fora do catálogo e valor fora da faixa plausível.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'

describe('Feature 030 — patient_measurements append-only + coerência', () => {
  let tenantId: string
  let patientId: string
  let actorId: string
  let measurementId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('pm-append')).tenantId
    patientId = await seedPatient(tenantId)
    actorId = (await seedUser(tenantId, 'profissional_saude')).userId

    const sb = serviceClient()
    const { data, error } = await sb
      .from('patient_measurements')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        metric_type: 'hba1c',
        value: 7.8,
        unit: '%',
        measured_at: '2026-05-01',
        created_by_user_id: actorId,
      })
      .select('id')
      .single()
    if (error) throw new Error(`seed measurement: ${error.message}`)
    measurementId = (data as { id: string }).id
  })

  it('UPDATE é rejeitado mesmo via service-role (trigger)', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('patient_measurements')
      .update({ value: 9.9 })
      .eq('id', measurementId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/append-only/i)

    const { data } = await sb
      .from('patient_measurements')
      .select('value')
      .eq('id', measurementId)
      .single()
    expect(Number((data as { value: number }).value)).toBe(7.8)
  })

  it('DELETE é rejeitado mesmo via service-role (trigger)', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('patient_measurements')
      .delete()
      .eq('id', measurementId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/DELETE not allowed/i)
  })

  it('metric_type fora do catálogo é rejeitado (METRIC_TYPE_UNKNOWN)', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('patient_measurements').insert({
      tenant_id: tenantId,
      patient_id: patientId,
      metric_type: 'metric_inexistente',
      value: 10,
      unit: 'x',
      measured_at: '2026-05-01',
      created_by_user_id: actorId,
    })
    expect(error).not.toBeNull()
    // FK ou trigger — qualquer um dos dois bloqueia com mensagem clara.
    expect(error!.message).toMatch(/METRIC_TYPE_UNKNOWN|foreign key/i)
  })

  it('valor fora da faixa plausível é rejeitado (HbA1c 99)', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('patient_measurements').insert({
      tenant_id: tenantId,
      patient_id: patientId,
      metric_type: 'hba1c',
      value: 99,
      unit: '%',
      measured_at: '2026-05-01',
      created_by_user_id: actorId,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/MEASUREMENT_OUT_OF_RANGE/)
  })

  it('unit vazia recebe o default do catálogo', async () => {
    const sb = serviceClient()
    const { data, error } = await sb
      .from('patient_measurements')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        metric_type: 'glicemia_jejum',
        value: 105,
        unit: '',
        measured_at: '2026-05-02',
        created_by_user_id: actorId,
      })
      .select('unit')
      .single()
    expect(error).toBeNull()
    expect((data as { unit: string }).unit).toBe('mg/dL')
  })
})

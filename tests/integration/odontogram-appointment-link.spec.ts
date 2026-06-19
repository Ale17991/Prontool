/**
 * Feature 039 (US3/FR-018) — vínculo de marcação a atendimento.
 * Vínculo válido persiste; atendimento de outro paciente é rejeitado pelo
 * trigger de consistência.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'

describe('odontograma — vínculo a atendimento', () => {
  let tenantId: string
  let patientId: string
  let otherPatientId: string
  let appointmentId: string
  let statusId: string
  let actorId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('odo-appt')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorId = admin.userId
    const { doctorId } = await seedDoctor(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010012')
    const procedureId = await seedProcedure(tenantId, '00010012')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    patientId = await seedPatient(tenantId)
    otherPatientId = await seedPatient(tenantId)
    const { data: comm } = await serviceClient()
      .from('doctor_commission_history')
      .select('id')
      .eq('doctor_id', doctorId)
      .single()
    appointmentId = await seedAppointment({
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId,
      patientId,
      commissionId: (comm as { id: string }).id,
      amountCents: 20000,
      commissionBps: 3000,
    })
    const { data: status } = await serviceClient()
      .from('dental_status_catalog')
      .select('id')
      .eq('code', 'caries')
      .single()
    statusId = (status as { id: string }).id
  })

  it('vínculo válido (mesmo paciente do atendimento) persiste', async () => {
    const { error } = await serviceClient()
      .from('dental_chart_entries')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        appointment_id: appointmentId,
        tooth_fdi: 16,
        surface: 'occlusal_incisal',
        status_id: statusId,
        created_by: actorId,
      })
    expect(error).toBeNull()
  })

  it('atendimento de outro paciente é rejeitado', async () => {
    const { error } = await serviceClient()
      .from('dental_chart_entries')
      .insert({
        tenant_id: tenantId,
        patient_id: otherPatientId,
        appointment_id: appointmentId,
        tooth_fdi: 17,
        surface: 'occlusal_incisal',
        status_id: statusId,
        created_by: actorId,
      })
    expect(error).not.toBeNull()
  })
})

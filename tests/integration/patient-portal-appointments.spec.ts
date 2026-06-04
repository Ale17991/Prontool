/**
 * T031 (Feature 030) — US3: histórico de atendimentos no bundle do portal.
 *
 *  - paciente com 3 atendimentos vê os 3, em ordem (mais recente primeiro),
 *    com data e profissional (FR-009);
 *  - NENHUM campo financeiro sai no payload;
 *  - atendimento de outro paciente não aparece.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedClinicProfile,
  seedPatientWithPii,
  seedPatient,
  seedDoctor,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import {
  createPatientSessionCookie,
  PATIENT_SESSION_COOKIE_NAME,
} from '@/lib/core/patient-portal/session'
import { GET as dadosGet } from '@/app/api/paciente/dados/route'
import type { NextRequest } from 'next/server'

describe('Feature 030 — histórico de atendimentos no portal (US3)', () => {
  let tenantId: string
  let patientId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('portal-appt')).tenantId
    await seedClinicProfile(tenantId, { slug: 'clinica-portal-appt' })
    patientId = await seedPatientWithPii(tenantId, {
      cpf: '52998224725',
      birthDate: '1990-05-15',
    })
    const otherPatient = await seedPatient(tenantId)

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
    const sb = serviceClient()
    const { data: comm } = await sb
      .from('doctor_commission_history')
      .select('id')
      .eq('doctor_id', doctorId)
      .single()
    const commissionId = (comm as unknown as { id: string }).id

    const base = {
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId,
      commissionId,
      amountCents: 20000,
      commissionBps: 3000,
    }
    await seedAppointment({ ...base, patientId, at: '2026-03-01T13:00:00Z' })
    await seedAppointment({ ...base, patientId, at: '2026-04-01T13:00:00Z' })
    await seedAppointment({ ...base, patientId, at: '2026-05-01T13:00:00Z' })
    // Atendimento de OUTRO paciente — não pode aparecer.
    await seedAppointment({ ...base, patientId: otherPatient, at: '2026-05-02T13:00:00Z' })
  })

  it('bundle traz os 3 atendimentos do paciente, ordenados, sem financeiro', async () => {
    const cookie = createPatientSessionCookie({ patientId, tenantId })
    const res = await dadosGet(
      new Request('http://localhost/api/paciente/dados', {
        headers: { cookie: `${PATIENT_SESSION_COOKIE_NAME}=${cookie}` },
      }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)
    const bundle = (await res.json()) as {
      appointments: Array<Record<string, unknown>>
    }
    expect(bundle.appointments).toHaveLength(3)

    // Mais recente primeiro
    const dates = bundle.appointments.map((a) => a.appointmentAt as string)
    expect(dates).toEqual([...dates].sort().reverse())

    // Data + profissional presentes; nada financeiro no payload (FR-009)
    const serialized = JSON.stringify(bundle.appointments)
    expect(bundle.appointments[0]!.doctorName).toBeTruthy()
    expect(serialized).not.toMatch(/amount|cents|commission|price|valor/i)
  })
})

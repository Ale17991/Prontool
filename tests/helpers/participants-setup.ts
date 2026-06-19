import { serviceClient } from './supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedAppointment,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedPatient,
  seedAppointmentProcedure,
  seedAppointmentCompletion,
  seedTissDomainEntry,
} from './seed-factories'
import { mintJwt } from './jwt-helper'

export interface ParticipantScenario {
  tenantId: string
  adminUserId: string
  adminJwt: string
  appointmentId: string
  /** Linha de appointment_procedures (sequence=1). */
  procedureLineId: string
  procedureId: string // procedures.id (para criar linhas extras)
  planId: string
  priceVersionId: string
  principalDoctorId: string
  doctorComissionadoId: string
  doctorFixoId: string
  doctorLiberalId: string
}

/**
 * Cenário base da feature 031: um atendimento com 1 linha de procedimento,
 * médicos de cada modalidade disponíveis como participantes, admin + jwt, e
 * graus do domínio TISS 35 semeados (00/01/06).
 */
export async function setupParticipantScenario(
  slug = 'participants',
  opts: { appointmentAt?: string } = {},
): Promise<ParticipantScenario> {
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

  // Graus de participação (domínio 35) — catálogo não é semeado pelo reset.
  await seedTissDomainEntry('35', '00', 'Cirurgião')
  await seedTissDomainEntry('35', '01', 'Primeiro Auxiliar')
  await seedTissDomainEntry('35', '06', 'Anestesista')

  const principal = await seedDoctor(tenantId) // comissionado (executante)
  const comissionado = await seedDoctor(tenantId)
  const fixo = await seedDoctor(tenantId, { paymentMode: 'fixo' })
  const liberal = await seedDoctor(tenantId, { paymentMode: 'liberal' })

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
  const patientId = await seedPatient(tenantId)

  const sb = serviceClient()
  const { data: comm } = await sb
    .from('doctor_commission_history')
    .select('id')
    .eq('doctor_id', principal.doctorId)
    .single()
  const commissionId = (comm as unknown as { id: string }).id

  const appointmentId = await seedAppointment({
    tenantId,
    doctorId: principal.doctorId,
    planId,
    procedureId,
    priceVersionId,
    patientId,
    commissionId,
    amountCents: 20000,
    commissionBps: 3000,
    at: opts.appointmentAt,
  })

  const procedureLineId = await seedAppointmentProcedure({
    tenantId,
    appointmentId,
    procedureId, // linha particular (plan_id NULL) — satisfaz price-coherence
    lineAmountCents: 20000,
    sequence: 1,
  })

  // Atendimento REALIZADO (effective_status='ativo') — estado realista para
  // ter equipe e entrar no repasse.
  await seedAppointmentCompletion({ tenantId, appointmentId })

  return {
    tenantId,
    adminUserId: admin.userId,
    adminJwt,
    appointmentId,
    procedureLineId,
    procedureId,
    planId,
    priceVersionId,
    principalDoctorId: principal.doctorId,
    doctorComissionadoId: comissionado.doctorId,
    doctorFixoId: fixo.doctorId,
    doctorLiberalId: liberal.doctorId,
  }
}

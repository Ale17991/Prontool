/**
 * T032 (Feature 026, US3) — registro auditável de emissão e exclusão.
 *
 * Emitir → prescription_records 'issued' + audit prescription.issued (idempotente
 * por memed_prescription_id). Excluir → 'deleted'/deleted_at + audit
 * prescription.deleted (idempotente). Constituição I/II.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor, seedPatient } from '@/tests/helpers/seed-factories'
import {
  recordPrescriptionIssued,
  recordPrescriptionDeleted,
} from '@/lib/core/integrations/memed/record-prescription'

async function fixture() {
  const { tenantId } = await seedTenant('memed-rec')
  const admin = await seedUser(tenantId, 'profissional_saude')
  const { doctorId } = await seedDoctor(tenantId)
  const patientId = await seedPatient(tenantId)
  return {
    sb: serviceClient(),
    tenantId,
    doctorId,
    patientId,
    actorUserId: admin.userId,
    actorLabel: `user:${admin.email}`,
    memedId: `rx-${randomUUID().slice(0, 8)}`,
  }
}

describe('Feature 026 — record issued/deleted', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('emite (idempotente) e audita prescription.issued', async () => {
    const f = await fixture()
    const args = {
      supabase: f.sb,
      tenantId: f.tenantId,
      appointmentId: null,
      patientId: f.patientId,
      doctorId: f.doctorId,
      memedPrescriptionId: f.memedId,
      actorUserId: f.actorUserId,
      actorLabel: f.actorLabel,
    }
    const first = await recordPrescriptionIssued(args)
    expect(first.created).toBe(true)

    const second = await recordPrescriptionIssued(args)
    expect(second.created).toBe(false) // idempotente

    const { data: rows } = await f.sb
      .from('prescription_records')
      .select('id, status')
      .eq('tenant_id', f.tenantId)
      .eq('memed_prescription_id', f.memedId)
    expect(rows ?? []).toHaveLength(1)

    const { data: audit } = await f.sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', f.tenantId)
      .eq('field', 'prescription.issued')
    expect((audit ?? []).length).toBe(1)
  })

  it('exclui (idempotente) e audita prescription.deleted', async () => {
    const f = await fixture()
    await recordPrescriptionIssued({
      supabase: f.sb,
      tenantId: f.tenantId,
      appointmentId: null,
      patientId: f.patientId,
      doctorId: f.doctorId,
      memedPrescriptionId: f.memedId,
      actorUserId: f.actorUserId,
      actorLabel: f.actorLabel,
    })

    const del = await recordPrescriptionDeleted({
      supabase: f.sb,
      tenantId: f.tenantId,
      memedPrescriptionId: f.memedId,
      actorUserId: f.actorUserId,
      actorLabel: f.actorLabel,
    })
    expect(del.updated).toBe(true)

    const again = await recordPrescriptionDeleted({
      supabase: f.sb,
      tenantId: f.tenantId,
      memedPrescriptionId: f.memedId,
      actorUserId: f.actorUserId,
      actorLabel: f.actorLabel,
    })
    expect(again.updated).toBe(false) // idempotente

    const { data: row } = await f.sb
      .from('prescription_records')
      .select('status, deleted_at')
      .eq('tenant_id', f.tenantId)
      .eq('memed_prescription_id', f.memedId)
      .maybeSingle()
    expect((row as { status?: string } | null)?.status).toBe('deleted')
    expect((row as { deleted_at?: string } | null)?.deleted_at).not.toBeNull()

    const { data: audit } = await f.sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', f.tenantId)
      .eq('field', 'prescription.deleted')
    expect((audit ?? []).length).toBe(1)
  })
})

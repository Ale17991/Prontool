/**
 * LGPD anonymize: paciente vira placeholder, registros de texto têm
 * content zerado, registros de arquivo têm metadados zerados, segundo
 * call → 409. Apenas admin pode disparar.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { upsertPatientFromGhl } from '@/lib/core/patients/upsert-from-ghl'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { piiRegistry } from '@/tests/helpers/msw-spies'

describe('POST /api/pacientes/[id]/anonymize — LGPD', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('apaga PII do paciente, zera content de registros, idempotente via 409', async () => {
    const { tenantId } = await seedTenant('an-1')
    const sb = serviceClient()
    const { patientId } = await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl_anon',
      fullName: 'Pedro Anônimo Silva',
      cpf: '12345678901',
      phone: '+5511988887777',
    })
    piiRegistry.register('Pedro Anônimo Silva', '12345678901', '+5511988887777')
    const admin = await seedUser(tenantId, 'admin')

    // Cria um registro de texto antes de anonimizar
    await sb
      .from('clinical_records')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        title: 'Anamnese',
        type: 'texto',
        content: 'Paciente Pedro Anônimo Silva, CPF 12345678901, queixa principal...',
        created_by: admin.userId,
      })
      .throwOnError()

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST } = await import('@/app/api/pacientes/[id]/anonymize/route')
    const res = await POST(
      new Request(`http://localhost/api/pacientes/${patientId}/anonymize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ reason: 'Solicitação LGPD do titular dos dados' }),
      }),
      { params: { id: patientId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { recordsAnonymized: number; anonymizedAt: string }
    expect(body.recordsAnonymized).toBe(1)
    expect(body.anonymizedAt).toBeTruthy()

    // Conteúdo do registro foi substituído pelo placeholder
    const { data: record } = await sb
      .from('clinical_records')
      .select('content')
      .eq('patient_id', patientId)
      .single()
    expect(record?.content).toBe('[anonimizado]')
    expect(record?.content).not.toMatch(/Pedro/)

    // Detalhe do paciente devolve placeholder
    const { GET } = await import('@/app/api/pacientes/[id]/route')
    const detail = await GET(
      new Request(`http://localhost/api/pacientes/${patientId}`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    const detailBody = (await detail.json()) as {
      patient: { fullName: string; anonymizedAt: string | null }
    }
    expect(detailBody.patient.fullName).toBe('[anonimizado]')
    expect(detailBody.patient.anonymizedAt).toBeTruthy()

    // Segundo call → 409
    const second = await POST(
      new Request(`http://localhost/api/pacientes/${patientId}/anonymize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ reason: 'Tentativa duplicada para fechar trilha' }),
      }),
      { params: { id: patientId } },
    )
    expect(second.status).toBe(409)
  })

  it('recepcionista → 403', async () => {
    const { tenantId } = await seedTenant('an-rbac')
    const sb = serviceClient()
    const { patientId } = await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl_rbac',
      fullName: 'Joana Teste',
      cpf: '99999999999',
    })
    piiRegistry.register('Joana Teste', '99999999999')
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    const { POST } = await import('@/app/api/pacientes/[id]/anonymize/route')
    const res = await POST(
      new Request(`http://localhost/api/pacientes/${patientId}/anonymize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ reason: 'Tentativa não autorizada de anonimização' }),
      }),
      { params: { id: patientId } },
    )
    expect(res.status).toBe(403)
  })
})

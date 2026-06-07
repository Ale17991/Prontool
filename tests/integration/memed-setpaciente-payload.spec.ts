/**
 * Feature 027 — item 2 do registro de aceite Memed (FR-007).
 *
 * O payload do `setPaciente` é montado server-side a partir do paciente
 * decifrado: nome, CPF, e-mail, celular e nascimento completos. Paciente com
 * dados faltando → MemedPatientFieldsMissingError (422) listando os campos —
 * nunca um payload parcial.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { createPatientManually } from '@/lib/core/patients/create-manual'
import { buildSetPaciente } from '@/lib/core/integrations/memed/set-paciente'
import { MemedPatientFieldsMissingError } from '@/lib/core/integrations/memed/errors'

async function fixture() {
  const { tenantId } = await seedTenant('memed-setpac')
  const admin = await seedUser(tenantId, 'admin')
  return { sb: serviceClient(), tenantId, actorUserId: admin.userId }
}

describe('Feature 027 — setPaciente payload completo', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('paciente completo → payload com nome/CPF/e-mail/celular/nascimento decifrados', async () => {
    const f = await fixture()
    const { patientId } = await createPatientManually(f.sb, {
      tenantId: f.tenantId,
      actorUserId: f.actorUserId,
      fullName: 'Maria Prescrição Teste',
      cpf: '52998224725',
      phone: '(11) 98888-7777',
      email: 'maria.memed@example.com',
      birthDate: '1990-03-15',
      sex: 'feminino',
      address: { cep: '01310-100', street: 'Av. Paulista', city: 'São Paulo', state: 'SP' },
    })

    const payload = await buildSetPaciente({
      supabase: f.sb,
      tenantId: f.tenantId,
      patientId,
    })

    expect(payload.external_id).toBe(patientId)
    expect(payload.nome).toBe('Maria Prescrição Teste')
    expect(payload.cpf).toBe('52998224725')
    expect(payload.email).toBe('maria.memed@example.com')
    expect(payload.telefone).toBe('(11) 98888-7777')
    expect(payload.data_nascimento).toBe('15/03/1990') // DD/MM/AAAA exigido pela Memed
    expect(payload.sexo).toBe('F')
    expect(payload.endereco?.cidade).toBe('São Paulo')
  })

  it('paciente incompleto → MemedPatientFieldsMissingError listando os campos', async () => {
    const f = await fixture()
    // Só nome + CPF — sem e-mail, celular nem nascimento (cadastro mínimo
    // permitido desde que a obrigatoriedade saiu do formulário).
    const { patientId } = await createPatientManually(f.sb, {
      tenantId: f.tenantId,
      actorUserId: f.actorUserId,
      fullName: 'José Incompleto Teste',
      cpf: '15350946056',
    })

    const attempt = buildSetPaciente({
      supabase: f.sb,
      tenantId: f.tenantId,
      patientId,
    })

    await expect(attempt).rejects.toBeInstanceOf(MemedPatientFieldsMissingError)
    await expect(attempt).rejects.toThrow(/e-mail/)
    await expect(attempt).rejects.toThrow(/celular/)
    await expect(attempt).rejects.toThrow(/data de nascimento/)
  })

  it('paciente sem CPF → bloqueado (CPF listado como faltante)', async () => {
    const f = await fixture()
    const { patientId } = await createPatientManually(f.sb, {
      tenantId: f.tenantId,
      actorUserId: f.actorUserId,
      fullName: 'Ana Sem CPF Teste',
      cpf: null,
      phone: '(21) 97777-6666',
      email: 'ana.memed@example.com',
      birthDate: '1985-12-01',
    })

    await expect(
      buildSetPaciente({ supabase: f.sb, tenantId: f.tenantId, patientId }),
    ).rejects.toThrow(/CPF/)
  })
})

/**
 * Migration 0105 — campos de identificação clínica do paciente.
 *
 * Garante o ciclo completo dos novos campos (sexo, nome social, nome da mãe,
 * RG, carteirinha do convênio, contato de emergência, responsável legal):
 *   1. POST /api/pacientes grava e GET /api/pacientes/{id} devolve decifrado.
 *   2. A PII nova fica cifrada em repouso (bytea, sem vazar texto puro); `sex`
 *      é coluna em claro (domínio fechado, usado em referência clínica).
 *   3. PATCH /api/pacientes/{id} edita e limpa (null) os campos.
 *   4. `sex` fora do domínio é rejeitado (400) pelo schema.
 *
 * Falhar aqui significa regressão na cifra, na RPC `get_patient_for_tenant`
 * ou no contrato das rotas — qualquer um deles quebra o cadastro clínico.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { piiRegistry } from '@/tests/helpers/msw-spies'

const NEW_ENC_COLUMNS = [
  'social_name_enc',
  'mother_name_enc',
  'rg_enc',
  'insurance_card_number_enc',
  'emergency_contact_name_enc',
  'emergency_contact_phone_enc',
  'guardian_name_enc',
  'guardian_cpf_enc',
  'guardian_relationship_enc',
] as const

interface PatientDetailBody {
  patient: {
    sex: string | null
    socialName: string | null
    motherName: string | null
    rg: string | null
    insuranceCardNumber: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    guardianName: string | null
    guardianCpf: string | null
    guardianRelationship: string | null
  }
}

const IDENTITY = {
  full_name: 'ZZZPacienteIdentidadeXYZ',
  cpf: '11122233344',
  sex: 'feminino',
  social_name: 'Nome Social Unico QWE',
  mother_name: 'Mae Unica ASD',
  rg: 'MG-77.888.999',
  insurance_card_number: 'CARTEIRA-555444333',
  emergency_contact_name: 'Contato Emergencia RTY',
  emergency_contact_phone: '+5531911112222',
  guardian_name: 'Responsavel Legal FGH',
  guardian_cpf: '55544433322',
  guardian_relationship: 'Mae',
} as const

async function createAdminSession(slug: string) {
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const jwt = mintJwt({
    userId: admin.userId,
    email: admin.email,
    tenantId,
    role: 'admin',
  })
  return { tenantId, jwt }
}

function postReq(jwt: string, body: unknown): Request {
  return new Request('http://localhost/api/pacientes', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Migration 0105 — identificação clínica do paciente', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('cria com os campos novos e devolve tudo decifrado no GET', async () => {
    const { jwt } = await createAdminSession('id-create')
    piiRegistry.register(...Object.values(IDENTITY))

    const { POST } = await import('@/app/api/pacientes/route')
    const created = await POST(postReq(jwt, IDENTITY))
    expect(created.status).toBe(201)
    const { patientId } = (await created.json()) as { patientId: string }
    expect(patientId).toBeTruthy()

    const { GET } = await import('@/app/api/pacientes/[id]/route')
    const detail = await GET(
      new Request(`http://localhost/api/pacientes/${patientId}`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    expect(detail.status).toBe(200)
    const { patient } = (await detail.json()) as PatientDetailBody

    expect(patient.sex).toBe('feminino')
    expect(patient.socialName).toBe(IDENTITY.social_name)
    expect(patient.motherName).toBe(IDENTITY.mother_name)
    expect(patient.rg).toBe(IDENTITY.rg)
    expect(patient.insuranceCardNumber).toBe(IDENTITY.insurance_card_number)
    expect(patient.emergencyContactName).toBe(IDENTITY.emergency_contact_name)
    expect(patient.emergencyContactPhone).toBe(IDENTITY.emergency_contact_phone)
    expect(patient.guardianName).toBe(IDENTITY.guardian_name)
    // CPF do responsável é normalizado para só dígitos antes de salvar.
    expect(patient.guardianCpf).toBe('55544433322')
    expect(patient.guardianRelationship).toBe(IDENTITY.guardian_relationship)
  })

  it('grava a PII nova como bytea cifrado (sem vazar texto puro); sex em claro', async () => {
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
    expect(key, 'PATIENT_DATA_ENCRYPTION_KEY deve estar setada').toBeTruthy()

    const { tenantId, jwt } = await createAdminSession('id-enc')
    piiRegistry.register(...Object.values(IDENTITY))

    const { POST } = await import('@/app/api/pacientes/route')
    const created = await POST(postReq(jwt, IDENTITY))
    expect(created.status).toBe(201)

    const sb = serviceClient()
    const { data: row, error } = await sb
      .from('patients')
      .select(['sex', ...NEW_ENC_COLUMNS].join(', '))
      .eq('tenant_id', tenantId)
      .single()
    expect(error).toBeNull()
    const raw = row as unknown as Record<
      (typeof NEW_ENC_COLUMNS)[number],
      string
    > & { sex: string }

    // sex é texto em claro.
    expect(raw.sex).toBe('feminino')

    // cada coluna nova é bytea (forma textual `\x<hex>` do PostgREST).
    for (const col of NEW_ENC_COLUMNS) {
      expect(raw[col], `${col} ausente`).toBeTruthy()
      expect(raw[col], `${col} não é bytea hex`).toMatch(/^\\x[0-9a-f]+$/i)
    }

    // nenhum texto puro sobrevive nos bytes cifrados.
    const cipherBytes = Buffer.concat(
      NEW_ENC_COLUMNS.map((col) => Buffer.from(raw[col].slice(2), 'hex')),
    )
    const tokens: Array<[string, string]> = [
      ['social_name', IDENTITY.social_name],
      ['mother_name', IDENTITY.mother_name],
      ['rg', IDENTITY.rg],
      ['insurance_card_number', IDENTITY.insurance_card_number],
      ['emergency_contact_name', IDENTITY.emergency_contact_name],
      ['guardian_name', IDENTITY.guardian_name],
    ]
    for (const [label, token] of tokens) {
      expect(
        cipherBytes.includes(Buffer.from(token, 'utf8')),
        `ciphertext vazou ${label} ("${token}")`,
      ).toBe(false)
    }
  })

  it('edita e limpa (null) os campos via PATCH identity', async () => {
    const { jwt } = await createAdminSession('id-patch')
    piiRegistry.register(...Object.values(IDENTITY))

    const { POST } = await import('@/app/api/pacientes/route')
    const created = await POST(postReq(jwt, IDENTITY))
    const { patientId } = (await created.json()) as { patientId: string }

    const route = await import('@/app/api/pacientes/[id]/route')

    // Atualiza sexo + carteirinha; limpa o responsável.
    const patched = await route.PATCH(
      new Request(`http://localhost/api/pacientes/${patientId}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          identity: {
            sex: 'masculino',
            insurance_card_number: 'NOVA-CARTEIRA-000',
            guardian_name: null,
            guardian_cpf: null,
            guardian_relationship: null,
          },
        }),
      }),
      { params: { id: patientId } },
    )
    expect(patched.status).toBe(200)

    const detail = await route.GET(
      new Request(`http://localhost/api/pacientes/${patientId}`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    const { patient } = (await detail.json()) as PatientDetailBody
    expect(patient.sex).toBe('masculino')
    expect(patient.insuranceCardNumber).toBe('NOVA-CARTEIRA-000')
    expect(patient.guardianName).toBeNull()
    expect(patient.guardianCpf).toBeNull()
    expect(patient.guardianRelationship).toBeNull()
    // Campos não enviados permanecem inalterados.
    expect(patient.socialName).toBe(IDENTITY.social_name)
    expect(patient.rg).toBe(IDENTITY.rg)
  })

  it('rejeita sexo fora do domínio (400)', async () => {
    const { jwt } = await createAdminSession('id-badsex')
    const { POST } = await import('@/app/api/pacientes/route')
    const res = await POST(
      postReq(jwt, { full_name: 'Paciente X', sex: 'outro' }),
    )
    expect(res.status).toBe(400)
  })
})

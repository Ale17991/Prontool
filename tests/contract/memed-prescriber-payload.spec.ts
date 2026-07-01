/**
 * T013 (Feature 027 / US1, critério C2) — o payload do prescritor enviado à
 * Memed contém todos os campos obrigatórios, e a habilitação é bloqueada cedo
 * (antes de chamar a Memed) se qualquer campo faltar.
 *
 * Testa a função pura `buildPrescriberPayload` (sem rede/DB).
 */
import { describe, it, expect } from 'vitest'
import { buildPrescriberPayload } from '@/lib/core/integrations/memed/register-prescriber'
import type { DoctorDetail } from '@/lib/core/doctors/get'

const BASE: DoctorDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  fullName: 'Ana Maria Silva',
  crm: 'CRM-123',
  externalIdentifier: null,
  role: 'Médico',
  specialty: null,
  councilName: 'CRM',
  councilNumber: '123456',
  councilState: 'SP',
  cpf: '39053344705',
  birthDate: '1985-04-12',
  cbo: null,
  active: true,
  createdAt: '2024-01-01T00:00:00Z',
  userId: null,
  paymentMode: 'comissionado',
  currentPercentageBps: null,
  currentMonthlyAmountCents: null,
  currentBillingDay: null,
  currentLiberalDefaultCents: null,
  currentValidFrom: null,
}

describe('Feature 027 — payload do prescritor (C2)', () => {
  it('positivo: monta o payload completo (7 campos) a partir do cadastro', () => {
    const p = buildPrescriberPayload(BASE)
    expect(p.external_id).toBe(BASE.id)
    expect(p.nome).toBe('Ana')
    expect(p.sobrenome).toBe('Maria Silva')
    expect(p.cpf).toBe('39053344705')
    expect(p.board).toEqual({ board_code: 'CRM', board_number: '123456', board_state: 'SP' })
    expect(p.data_nascimento).toBe('12/04/1985')
  })

  it('envia a especialidade quando mapeada', () => {
    const p = buildPrescriberPayload(BASE, '5')
    expect(p.especialidade).toBe('5')
  })

  const negatives: Array<[string, Partial<DoctorDetail>]> = [
    ['nome completo vazio', { fullName: '  ' }],
    ['CPF ausente', { cpf: null }],
    ['CPF com menos de 11 dígitos', { cpf: '123' }],
    ['conselho ausente', { councilName: null }],
    ['número do conselho ausente', { councilNumber: null }],
    ['UF do conselho ausente', { councilState: null }],
    ['nascimento ausente', { birthDate: null }],
  ]

  for (const [label, patch] of negatives) {
    it(`bloqueia (antes de chamar a Memed) quando: ${label}`, () => {
      expect(() => buildPrescriberPayload({ ...BASE, ...patch })).toThrowError(
        /MEMED_PRESCRIBER_FIELDS_MISSING|Complete o cadastro/,
      )
    })
  }
})

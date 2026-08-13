/**
 * Feature 057 (T033) — janela de inatividade e teto absoluto da sessão do portal.
 *
 * São duas mortes independentes, e confundi-las é o defeito que estes testes
 * existem para impedir: `expMs` anda a cada página aberta; `iatMs` não anda
 * nunca. Se a renovação reescrevesse `iatMs`, o teto de 12h jamais chegaria e a
 * sessão de um portal com autenticação fraca viveria para sempre.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  PATIENT_SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  PATIENT_SESSION_MAX_AGE_SECONDS,
  createPatientSessionCookie,
  renewPatientSessionCookie,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'

const PATIENT = '11111111-1111-1111-1111-111111111111'
const TENANT = '22222222-2222-2222-2222-222222222222'
const T0 = 1_700_000_000_000
const MIN = 60_000

beforeAll(() => {
  // O segredo é de servidor; nos testes basta um valor com o tamanho mínimo.
  process.env.PATIENT_SESSION_SECRET ??= 'x'.repeat(48)
})

const fresh = (nowMs = T0) =>
  createPatientSessionCookie({ patientId: PATIENT, tenantId: TENANT, nowMs })

describe('Feature 057 — janela de INATIVIDADE', () => {
  it('vale enquanto o paciente está dentro dos 30 minutos', () => {
    const cookie = fresh()
    expect(verifyPatientSessionCookie(cookie, T0 + 29 * MIN)).not.toBeNull()
  })

  it('morre depois de 30 minutos parada', () => {
    const cookie = fresh()
    expect(verifyPatientSessionCookie(cookie, T0 + 31 * MIN)).toBeNull()
  })

  it('cada página aberta empurra o prazo — navegar por horas não derruba', () => {
    let cookie = fresh()
    let now = T0
    // 8 horas navegando, uma página a cada 25 minutos (dentro da janela).
    for (let i = 0; i < 19; i++) {
      now += 25 * MIN
      const renewed = renewPatientSessionCookie(cookie, now)
      expect(renewed).not.toBeNull()
      cookie = renewed!
    }
    expect(verifyPatientSessionCookie(cookie, now)).not.toBeNull()
  })

  it('a renovação PRESERVA iatMs — senão o teto absoluto nunca chegaria', () => {
    const cookie = fresh()
    const renewed = renewPatientSessionCookie(cookie, T0 + 20 * MIN)!
    const before = verifyPatientSessionCookie(cookie, T0)!
    const after = verifyPatientSessionCookie(renewed, T0 + 20 * MIN)!

    expect(after.iatMs).toBe(before.iatMs)
    expect(after.expMs).toBeGreaterThan(before.expMs)
    expect(after.expMs).toBe(T0 + 20 * MIN + PATIENT_SESSION_MAX_AGE_SECONDS * 1000)
  })
})

describe('Feature 057 — teto ABSOLUTO', () => {
  const absoluteMs = PATIENT_SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000

  it('derruba a sessão 12h após o login, mesmo renovada o tempo todo', () => {
    let cookie = fresh()
    let now = T0
    for (let i = 0; i < 40; i++) {
      now += 20 * MIN
      const renewed = renewPatientSessionCookie(cookie, now)
      if (!renewed) break
      cookie = renewed
    }
    // Passadas as 12h desde o login, nem a renovação nem a verificação valem.
    expect(verifyPatientSessionCookie(cookie, T0 + absoluteMs)).toBeNull()
    expect(renewPatientSessionCookie(cookie, T0 + absoluteMs)).toBeNull()
  })

  it('em uso contínuo, sobrevive até quase o teto', () => {
    // Não dá para "pular" para perto do teto renovando uma vez: um cookie
    // parado há horas já morreu por inatividade. Chegar lá exige justamente o
    // que a feature promete — usar o portal de tempos em tempos.
    let cookie = fresh()
    let now = T0
    while (now + 20 * MIN < T0 + absoluteMs) {
      now += 20 * MIN
      const renewed = renewPatientSessionCookie(cookie, now)
      expect(renewed).not.toBeNull()
      cookie = renewed!
    }
    // 12h dividem exatamente em passos de 20 min, então o laço para NO limite.
    expect(now).toBeGreaterThanOrEqual(T0 + absoluteMs - 20 * MIN)
    expect(verifyPatientSessionCookie(cookie, now)).not.toBeNull()
  })
})

describe('Feature 057 — renovação não ressuscita sessão morta', () => {
  it('não renova cookie ausente', () => {
    expect(renewPatientSessionCookie(undefined)).toBeNull()
    expect(renewPatientSessionCookie(null)).toBeNull()
    expect(renewPatientSessionCookie('')).toBeNull()
  })

  it('não renova cookie adulterado', () => {
    const cookie = fresh()
    const [body] = cookie.split('.')
    expect(renewPatientSessionCookie(`${body}.deadbeef`, T0)).toBeNull()
  })

  it('não renova sessão já expirada por inatividade', () => {
    // É o que impede o "keep-alive" de reabrir uma sessão que já caiu.
    expect(renewPatientSessionCookie(fresh(), T0 + 31 * MIN)).toBeNull()
  })
})

/**
 * T032 (spec 027, US5) — scan de vazamento de credenciais no navegador real.
 *
 * Percorre o fluxo completo (login → atendimento → prescrever → emitir →
 * registro) agregando TODAS as URLs/headers/bodies de request e os bodies de
 * response que chegam ao navegador. Ao final, procura:
 *   - os valores-sentinela das chaves staging (injetados no server via env);
 *   - as chaves públicas de homologação da doc da Memed (server-side only);
 *   - padrões `api-key=` / `secret-key=` (query string do client server-side).
 * Qualquer ocorrência = credencial vazou para o front (item 5 do aceite).
 */
import { test, expect } from '@playwright/test'
import { MEMED_E2E_SENTINELS } from '../../playwright.memed.config'
import { loginAsAdmin } from './fixtures'
import { seedMemedFixture, stubMemedSdk, openPrescription, type MemedE2eFixture } from './memed-helpers'

// Chaves públicas de homologação (hardcoded na cápsula server-side) — também
// não podem aparecer no navegador.
const STAGING_PUBLIC_KEYS = [
  'iJGiB4kjDGOLeDFPWMG3no9VnN7Abpqe3w1jEFm6olkhkZD6oSfSmYCm',
  'Xe8M5GvBGCr4FStKfxXKisRo3SfYKI7KrTMkJpCAstzu2yXVN4av5nmL',
]

let fixture: MemedE2eFixture

test.beforeAll(async () => {
  fixture = await seedMemedFixture()
})

test('fluxo completo de prescrição não vaza api_key/secret_key para o navegador', async ({ page }) => {
  const haystacks: string[] = []

  page.on('request', (req) => {
    haystacks.push(req.url())
    haystacks.push(JSON.stringify(req.headers()))
    const post = req.postData()
    if (post) haystacks.push(post)
  })
  page.on('response', (res) => {
    const ct = res.headers()['content-type'] ?? ''
    if (!/json|text|javascript|html/.test(ct)) return
    // Body pode ficar indisponível após navegação — ignorar nesses casos.
    void res
      .text()
      .then((body) => haystacks.push(body))
      .catch(() => {})
  })

  await stubMemedSdk(page)
  await loginAsAdmin(page)

  // Prescrever: token do prescritor + paciente decifrado + iframe com paciente.
  await openPrescription(page, fixture.appointmentId, fixture.patientName)

  // Emite a prescrição pelo iframe (caminho real postMessage → MdHub → POST).
  const rxId = `rx-e2e-${Date.now().toString(36)}`
  const recorded = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/atendimentos/${fixture.appointmentId}/prescricoes`) &&
      res.request().method() === 'POST' &&
      res.ok(),
    // 60s: primeiro hit compila a rota no dev server.
    { timeout: 60_000 },
  )
  await page.evaluate((id) => {
    ;(window as unknown as { __emitPrescricaoImpressa: (d: unknown) => void }).__emitPrescricaoImpressa({ id })
  }, rxId)
  await recorded

  // Registro visível no atendimento (recarrega para ver o card Prescrições).
  // 60s: o dev server pode ainda estar compilando a página (suspense fallback).
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText(`#${rxId}`)).toBeVisible({ timeout: 60_000 })

  // dá tempo dos últimos response.text() assíncronos aterrissarem
  await page.waitForTimeout(500)

  // --- scan final ---------------------------------------------------------
  const corpus = haystacks.join('\n').toLowerCase()
  const forbidden = [
    MEMED_E2E_SENTINELS.apiKey,
    MEMED_E2E_SENTINELS.secretKey,
    ...STAGING_PUBLIC_KEYS,
    'api-key=',
    'secret-key=',
  ]
  for (const needle of forbidden) {
    expect
      .soft(corpus.includes(needle.toLowerCase()), `credencial/padrão vazou no front: "${needle.slice(0, 24)}…"`)
      .toBe(false)
  }
  expect(haystacks.length).toBeGreaterThan(10) // sanity: o scan viu tráfego real
})

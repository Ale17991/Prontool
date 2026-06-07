/**
 * T039 (spec 027, polish) — smoke E2E do fluxo completo da Memed.
 *
 * Admin loga → (re)ativa a prescrição digital → habilita um profissional como
 * prescritor (rota real → POST /usuarios no mock) → abre o atendimento →
 * prescreve → emite pelo iframe → vê o registro no atendimento. ≤ 30s após o
 * login (SC do spec; aqui medimos a fase pós-ativação).
 */
import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './fixtures'
import { seedMemedFixture, stubMemedSdk, openPrescription, type MemedE2eFixture } from './memed-helpers'

let fixture: MemedE2eFixture

test.beforeAll(async () => {
  fixture = await seedMemedFixture()
})

test('ativar → habilitar prescritor → prescrever → emitir → registro visível', async ({ page }) => {
  await stubMemedSdk(page)
  await loginAsAdmin(page)

  // --- ativa a prescrição digital (rotas reais, cookies da sessão) ---------
  // Desativa primeiro para exercitar o caminho completo de ativação.
  await page.request.delete('/api/integracoes/memed')
  const activate = await page.request.post('/api/integracoes/memed', {
    data: { environment: 'staging', accept_terms: true },
  })
  expect(activate.ok(), `ativar memed falhou: ${activate.status()}`).toBe(true)

  // --- habilita o profissional (vai ao mock via POST /usuarios) ------------
  const enable = await page.request.post(`/api/medicos/${fixture.doctor2Id}/memed-prescritor`, {
    data: {},
  })
  expect(enable.ok(), `habilitar prescritor falhou: ${enable.status()}`).toBe(true)
  const enableBody = (await enable.json()) as { status?: string; external_id?: string }
  expect(enableBody.status).toBe('registered')

  // --- prescreve e emite ----------------------------------------------------
  const startedAt = Date.now()
  await openPrescription(page, fixture.appointment2Id, fixture.patientName)

  const rxId = `rx-fullflow-${Date.now().toString(36)}`
  const recorded = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/atendimentos/${fixture.appointment2Id}/prescricoes`) &&
      res.request().method() === 'POST' &&
      res.ok(),
    // 60s: primeiro hit compila a rota no dev server.
    { timeout: 60_000 },
  )
  await page.evaluate((id) => {
    ;(window as unknown as { __emitPrescricaoImpressa: (d: unknown) => void }).__emitPrescricaoImpressa({ id })
  }, rxId)
  await recorded

  // --- registro visível no atendimento --------------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText(`#${rxId}`)).toBeVisible({ timeout: 60_000 })

  // SC do spec: ≤30s vale para o build de produção (CI). Em dev mode o
  // compile-on-demand do Next infla o tempo — budget relaxado, só pra pegar
  // regressão grosseira. O tempo real é sempre impresso para tracking.
  const budgetMs = process.env.CI ? 30_000 : 90_000
  const elapsedMs = Date.now() - startedAt
  console.info(`[memed-full-flow] prescrever→registro em ${elapsedMs}ms (budget ${budgetMs}ms)`)
  expect(elapsedMs).toBeLessThanOrEqual(budgetMs)
})

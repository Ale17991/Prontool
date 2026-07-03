/**
 * T138 — End-to-end: admin downloads PDF + Excel from /relatorios/mensal.
 *
 * Covers User Story 4 happy path. Uses Playwright's `waitForEvent('download')`
 * to drive a real download, then asserts the file has non-zero bytes and the
 * correct content-type came back from the API. An empty report is fine — the
 * renderers produce a well-formed document even when the period has zero
 * appointments (checked by the integration tests already).
 */
import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { ensureDemoSeed, loadEnv, loginAsAdmin } from './fixtures'

loadEnv()

const PERIOD = { from: '2026-04-01', to: '2026-04-30' }

test('admin exports monthly report as PDF and Excel', async ({ page, request }) => {
  test.setTimeout(120_000)
  await ensureDemoSeed()

  await loginAsAdmin(page)
  await page.goto(`/analise/relatorios/mensal?from=${PERIOD.from}&to=${PERIOD.to}`)
  await expect(page.getByRole('heading', { name: 'Relatório mensal' })).toBeVisible()

  // --- PDF ----------------------------------------------------------------
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /^PDF$/ }).click(),
  ])
  const pdfPath = await pdfDownload.path()
  expect(pdfPath).toBeTruthy()
  const pdfBytes = readFileSync(pdfPath!)
  expect(pdfBytes.length).toBeGreaterThan(500)
  expect(pdfBytes.slice(0, 4).toString()).toBe('%PDF')
  expect(pdfDownload.suggestedFilename()).toMatch(
    new RegExp(`^relatorio-mensal-${PERIOD.from}-${PERIOD.to}\\.pdf$`),
  )

  // --- Excel --------------------------------------------------------------
  const [xlsxDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /^Excel$/ }).click(),
  ])
  const xlsxPath = await xlsxDownload.path()
  expect(xlsxPath).toBeTruthy()
  expect(statSync(xlsxPath!).size).toBeGreaterThan(500)
  // .xlsx is a ZIP — first two bytes are 'PK'.
  const xlsxBytes = readFileSync(xlsxPath!)
  expect(xlsxBytes.slice(0, 2).toString()).toBe('PK')
  expect(xlsxDownload.suggestedFilename()).toMatch(
    new RegExp(`^relatorio-mensal-${PERIOD.from}-${PERIOD.to}\\.xlsx$`),
  )

  // Also assert the API contract directly — the browser might accept a bad
  // content-type, but production clients won't.
  const cookies = await page.context().cookies()
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const pdfHead = await request.get(
    `/api/relatorios/mensal/export/pdf?from=${PERIOD.from}&to=${PERIOD.to}`,
    { headers: { cookie: cookieHeader } },
  )
  expect(pdfHead.status()).toBe(200)
  expect(pdfHead.headers()['content-type']).toContain('application/pdf')
  expect(pdfHead.headers()['content-disposition']).toContain('attachment')
})

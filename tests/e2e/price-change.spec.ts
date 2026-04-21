/**
 * T107 — End-to-end: admin edits a price, new head + history entry appear.
 *
 * Covers User Story 2 happy path: the optimistic-concurrency UI flow is
 * exercised via the real EditPriceForm + /api/precos/versions route. No
 * stubs: we navigate, edit, submit, then re-render the detail page and
 * assert the chain grew from 1 to 2 versions.
 */
import { test, expect } from '@playwright/test'
import {
  ensureDemoSeed,
  getDemoTenantId,
  loadEnv,
  loginAsAdmin,
  serviceClient,
} from './fixtures'

loadEnv()

test('admin edits a price and history shows the previous version', async ({ page }) => {
  test.setTimeout(120_000)
  await ensureDemoSeed()

  const sb = serviceClient()
  const tenantId = await getDemoTenantId(sb)

  // Pick a (procedure, plan) pair with a single existing head so the
  // assertion "history grew by one" stays stable even if the suite runs
  // multiple times against the same seed.
  const { data: seed } = await sb
    .from('price_versions')
    .select('id, procedure_id, plan_id, amount_cents')
    .eq('tenant_id', tenantId)
    .is('previous_version_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const target = seed?.[0]
  if (!target) throw new Error('demo seed missing price_versions — run pnpm seed:demo')

  const countBefore = await sb
    .from('price_versions')
    .select('id', { count: 'exact', head: true })
    .eq('procedure_id', target.procedure_id)
    .eq('plan_id', target.plan_id)
  const versionsBefore = countBefore.count ?? 0

  await loginAsAdmin(page)
  await page.goto(`/precos/${target.id}`)

  const newAmountReais = `${(Math.floor(target.amount_cents / 100) + 50).toFixed(2).replace('.', ',')}`
  const today = new Date().toISOString().slice(0, 10)

  await page.getByLabel('Novo valor (R$)').fill(newAmountReais)
  await page.getByLabel('Vigência a partir de').fill(today)
  await page.getByLabel('Motivo').fill('E2E price change')

  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/precos/versions') && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /criar nova versão/i }).click(),
  ])

  // Confirm in the DB before re-navigating — avoids flakiness around the
  // router.refresh() timing.
  await expect
    .poll(
      async () => {
        const after = await sb
          .from('price_versions')
          .select('id', { count: 'exact', head: true })
          .eq('procedure_id', target.procedure_id)
          .eq('plan_id', target.plan_id)
        return after.count ?? 0
      },
      { timeout: 10_000 },
    )
    .toBe(versionsBefore + 1)

  // History card on the detail page should now list 2+ rows.
  await page.goto(`/precos/${target.id}`)
  const historyRows = page.locator('table tbody tr')
  await expect(historyRows).toHaveCount(versionsBefore + 1)
})

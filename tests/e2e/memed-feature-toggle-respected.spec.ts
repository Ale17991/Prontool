/**
 * T034 (spec 027, US6) — feature toggles da Memed são respeitados pelo wrapper.
 *
 * A Memed pode desativar features do iframe via `setFeatureToggle`. O Clinni
 * não pode reativá-las: nenhum elemento próprio com data-feature, nenhuma CSS
 * externa sobrepondo display/visibility/pointer-events do iframe.
 */
import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './fixtures'
import { seedMemedFixture, stubMemedSdk, openPrescription, type MemedE2eFixture } from './memed-helpers'

let fixture: MemedE2eFixture

test.beforeAll(async () => {
  fixture = await seedMemedFixture()
})

test('setFeatureToggle desativado não é sobrescrito pelo wrapper Clinni', async ({ page }) => {
  await stubMemedSdk(page)
  await loginAsAdmin(page)
  await openPrescription(page, fixture.appointmentId, fixture.patientName)

  const frame = page.frameLocator('#memed-iframe-stub')
  const manualButton = frame.locator('[data-feature="manualPrescription"]')
  await expect(manualButton).toBeVisible()

  // Memed desativa a feature dentro do iframe.
  await page.evaluate(() => {
    ;(window as unknown as {
      __emitFeatureToggle: (a: { feature: string; enabled: boolean }) => void
    }).__emitFeatureToggle({ feature: 'manualPrescription', enabled: false })
  })

  // 1) Dentro do iframe a feature sumiu — e o wrapper não a ressuscitou.
  await expect(manualButton).toBeHidden()

  // 2) O dashboard não renderiza elementos próprios da feature desativada.
  await expect(page.locator('[data-feature="manualPrescription"]')).toHaveCount(0)

  // 3) Nenhuma CSS externa briga com o iframe (display/visibility/pointer-events).
  const iframeStyle = await page.evaluate(() => {
    const el = document.getElementById('memed-iframe-stub')
    if (!el) return null
    const cs = window.getComputedStyle(el)
    return { display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents }
  })
  expect(iframeStyle).not.toBeNull()
  expect(iframeStyle!.display).not.toBe('none')
  expect(iframeStyle!.visibility).toBe('visible')
  expect(iframeStyle!.pointerEvents).not.toBe('none')

  // 4) O wrapper apenas OBSERVOU o toggle (registro), sem reagir reativando.
  const observed = await page.evaluate(
    () => (window as unknown as { __lastFeatureToggle?: { feature: string; enabled: boolean } }).__lastFeatureToggle,
  )
  expect(observed).toEqual({ feature: 'manualPrescription', enabled: false })
})

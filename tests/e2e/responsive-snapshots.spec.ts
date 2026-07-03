import { test, expect, type Page } from '@playwright/test'

/**
 * Regressão visual da feature 003-responsive-design (spec.md SC-004).
 *
 * Captura screenshots de páginas-chave em 3 viewports:
 *   - 1280×720 (desktop)  — comparação contra baseline gravado ANTES das
 *     mudanças responsivas. Falha se houver diff perceptível, garantindo
 *     zero regressão visual em desktop.
 *   - 375×812  (iPhone X) — primeiro snapshot vira baseline pra futuras
 *     regressões mobile.
 *   - 768×1024 (iPad portrait) — idem como baseline.
 *
 * Como rodar:
 *   pnpm test:e2e tests/e2e/responsive-snapshots.spec.ts
 *
 * Como atualizar baseline (após mudança intencional):
 *   pnpm test:e2e tests/e2e/responsive-snapshots.spec.ts --update-snapshots
 *
 * Pré-requisito: Supabase local rodando + seed demo aplicado, igual ao
 * smoke-flow.spec.ts. Para a página /login (não-autenticada) o teste roda
 * sem dependência de seed.
 */

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280, height: 720 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 1024 },
] as const

const PUBLIC_PAGES = [{ path: '/login', label: 'login' }] as const

const AUTH_PAGES = [
  { path: '/operacao/pacientes', label: 'pacientes-list' },
  { path: '/analise/relatorios', label: 'dashboard-financeiro' },
] as const

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.locator('#email').fill('admin@clinica-demo.test')
  await page.locator('#password').fill('demo1234')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 30_000,
  })
  await page.waitForLoadState('networkidle')
}

for (const viewport of VIEWPORTS) {
  test.describe(`Responsive snapshots — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const route of PUBLIC_PAGES) {
      test(`${route.label} @ ${viewport.name}`, async ({ page }) => {
        await page.goto(route.path)
        await page.waitForLoadState('networkidle')
        // Aguarda fontes carregarem para evitar flicker em screenshot
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`${route.label}-${viewport.name}.png`, {
          fullPage: true,
          // Tolerância relaxada cobre antialiasing entre runs.
          maxDiffPixelRatio: 0.02,
        })
      })
    }

    for (const route of AUTH_PAGES) {
      test(`${route.label} @ ${viewport.name}`, async ({ page }) => {
        await loginAsAdmin(page)
        await page.goto(route.path)
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        // Aguarda 500ms pra estabilizar animações de fade-in / framer-motion
        await page.waitForTimeout(500)
        await expect(page).toHaveScreenshot(`${route.label}-${viewport.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.02,
        })
      })
    }
  })
}

test.describe('Drawer mobile — interação @ 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('hamburger abre drawer; clicar em link fecha', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/operacao/pacientes')
    await page.waitForLoadState('networkidle')

    // Antes de abrir: sidebar permanente NÃO está visível (md:hidden).
    // O drawer não está renderizado ainda (Radix Sheet só renderiza no
    // open). Hamburger button disponível.
    const hamburger = page.getByRole('button', { name: /abrir menu/i })
    await expect(hamburger).toBeVisible()

    // Abrir drawer
    await hamburger.click()
    const navTitle = page.getByRole('heading', { name: 'Navegação' })
    await expect(navTitle).toBeVisible()

    // Snapshot do drawer aberto
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500) // animação de slide-in completar
    await expect(page).toHaveScreenshot('drawer-aberto-mobile-375.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    })

    // Clicar em "Cadastros" deve navegar e fechar drawer
    await page
      .getByRole('link', { name: /cadastros/i })
      .first()
      .click()
    await page.waitForURL(/\/cadastros/, { timeout: 10_000 })
    await expect(navTitle).not.toBeVisible()
  })
})

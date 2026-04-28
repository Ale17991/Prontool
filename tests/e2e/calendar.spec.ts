import { expect, test } from '@playwright/test'

/**
 * Smoke E2E para feature 004 / US1: alternar Lista <-> Calendario,
 * confirmar grid renderizado, clicar slot vazio e validar URL destino.
 */
test('atendimentos calendar smoke: toggle + slot click', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.locator('#email').fill('admin@clinica-demo.test')
  await page.locator('#password').fill('demo1234')
  await page.getByRole('button', { name: /entrar/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

  await page.goto('/operacao/atendimentos')
  await page.waitForLoadState('networkidle')

  // Toggle to Calendario
  await page.getByRole('button', { name: /^Calendário$/i }).click()
  await page.waitForURL((u) => u.searchParams.get('view') === 'cal', {
    timeout: 30_000,
  })

  // Header DOM/SEG/TER/QUA/QUI/SEX/SAB visivel
  await expect(page.getByText(/dom/i).first()).toBeVisible()

  // Hour gutter shows 07:00 e 22:00
  await expect(page.getByText('07:00').first()).toBeVisible()
  await expect(page.getByText('21:00').first()).toBeVisible()

  // Botao Hoje funciona (clica e a URL ainda tem view=cal)
  await page.getByRole('button', { name: /^Hoje$/i }).click()
  await expect(page).toHaveURL(/view=cal/)

  // Clicar em um slot vazio (primeiro botao com aria-label "Criar atendimento")
  // navega para /novo?at=...
  const slot = page.locator('button[aria-label^="Criar atendimento em"]').first()
  await slot.click()
  await page.waitForURL(/\/operacao\/atendimentos\/novo\?at=/, { timeout: 30_000 })

  // Confirma input datetime-local com valor pre-preenchido
  const dtInput = page.locator('#appointment_at')
  await expect(dtInput).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
})

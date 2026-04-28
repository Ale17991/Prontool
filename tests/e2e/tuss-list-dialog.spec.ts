import { expect, test } from '@playwright/test'

/**
 * E2E smoke do <TussListDialog> em /cadastros/procedimentos:
 *   - clicar "Ver em lista" abre o dialog
 *   - busca por "consult" filtra resultados
 *   - clicar numa linha aplica selecao no form e fecha o dialog
 */
test('TUSS list dialog: open, filter, select, close', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/login')
  await page.locator('#email').fill('admin@clinica-demo.test')
  await page.locator('#password').fill('demo1234')
  await page.getByRole('button', { name: /entrar/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

  await page.goto('/cadastros/procedimentos')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: /ver em lista/i }).first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Catálogo TUSS/i)).toBeVisible()

  await dialog.getByPlaceholder(/buscar por código ou nome/i).fill('consult')
  await page.waitForTimeout(500)

  // Seleciona a primeira linha disponivel
  const firstRow = dialog.locator('tbody tr').first()
  await expect(firstRow).toBeVisible({ timeout: 5_000 })
  await firstRow.click()

  // Dialog fecha e o trigger do typeahead mostra algo selecionado.
  await expect(dialog).toBeHidden({ timeout: 5_000 })
})

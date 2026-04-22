import { test, expect } from '@playwright/test'

// Smoke test end-to-end: login → criar paciente → criar modelo de anamnese
// → aplicar modelo → criar etapa de tratamento → conferir ficha clínica.
// Escrito como um test único para enxergar o fluxo inteiro num log só.

test('admin smoke flow: paciente → anamnese aplicada → etapa → ficha', async ({ page }) => {
  test.setTimeout(120_000)
  const logs: string[] = []
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push(`[console.error] ${msg.text()}`)
  })
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!/\/api\//.test(url)) return
    const body = await resp.text().catch(() => '')
    logs.push(`[${resp.status()}] ${resp.request().method()} ${url} — ${body.slice(0, 200)}`)
  })

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.locator('#email').fill('admin@clinica-demo.test')
  await page.locator('#password').fill('demo1234')
  // Confirma que os campos têm valor antes de submeter
  expect(await page.locator('#email').inputValue()).toBe('admin@clinica-demo.test')
  expect(await page.locator('#password').inputValue()).toBe('demo1234')
  await page.getByRole('button', { name: /entrar/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90_000 })
  console.log('[smoke] logged in, now at', page.url())

  // ---- Criar paciente manual ----
  await page.goto('/operacao/pacientes/novo')
  await page.getByLabel(/nome completo/i).fill(`Smoke Test ${Date.now()}`)
  await page.getByLabel(/cpf/i).fill('52998224725') // CPF sintético válido-ish pro formato
  await page.getByLabel(/telefone/i).fill('11988887777')
  await page.getByLabel(/e-mail/i).fill(`smoke.${Date.now()}@test.local`)
  // Plano obrigatório — selecionar Particular (3º item tipicamente; abrir o Select).
  await page.locator('#plan_id').click()
  await page.getByRole('option', { name: /^particular$/i }).first().click()
  const savePatient = page.getByRole('button', { name: /salvar paciente/i })
  await savePatient.scrollIntoViewIfNeeded()
  await savePatient.click()
  // Dá um respiro pro fetch disparar
  await page.waitForTimeout(500)
  await page.waitForURL(/\/operacao\/pacientes\/[0-9a-f-]{36}$/, { timeout: 90_000 }).catch((err) => {
    console.log('[smoke] waitForURL failed, current:', page.url())
    console.log('[smoke] api activity so far:')
    for (const l of logs) console.log('   ', l)
    throw err
  })
  const patientUrl = page.url()
  const patientId = patientUrl.split('/').pop()!
  console.log('[smoke] patient created:', patientId)

  // ---- Criar modelo de anamnese (usar a tela do builder) ----
  await page.goto('/analise/anamnese/novo')
  await page.getByPlaceholder(/título/i).first().fill(`Template Smoke ${Date.now()}`)

  // Adicionar um campo texto curto
  await page.getByRole('button', { name: /campo de texto/i }).click()
  // Rename the field label
  const fieldLabelInput = page.locator('input[placeholder="Rótulo do campo"]').first()
  await fieldLabelInput.fill('Queixa principal')
  await page.getByRole('button', { name: /salvar modelo/i }).click()
  await page.waitForURL(/\/analise\/anamnese$/, { timeout: 45_000 })
  console.log('[smoke] template created')

  // ---- Aplicar modelo: clicar em "Usar" na primeira linha ----
  await page.getByRole('link', { name: /usar/i }).first().click()
  await page.waitForURL(/\/analise\/anamnese\/[0-9a-f-]{36}\/usar$/, { timeout: 45_000 })

  // Selecionar o paciente recém-criado
  await page.locator('button[role="combobox"]').first().click()
  await page.getByRole('option').first().click() // pega o primeiro — já que só criamos 1
  // Preencher o campo "Queixa principal"
  const textInputs = page.locator('form input[type="text"], form input:not([type])')
  // O primeiro input do form de etapas é o próprio campo dinâmico
  await textInputs.first().fill('Dor lombar há 3 dias')
  await page.getByRole('button', { name: /salvar anamnese/i }).click()
  // Redireciona pro paciente
  await page.waitForURL(new RegExp(`/operacao/pacientes/${patientId}$`), { timeout: 45_000 })
  console.log('[smoke] anamnese applied')

  // ---- Criar etapa no plano de tratamento ----
  await page.getByRole('button', { name: /nova etapa/i }).click()
  await page.getByLabel(/título da etapa/i).fill('Sessão 1 — Consulta')
  await page.getByPlaceholder(/buscar por tuss/i).fill('10101012')
  // Esperar o item aparecer na lista e clicar
  const procOption = page.getByRole('button').filter({ hasText: '10101012' }).first()
  await procOption.click()
  // Data prevista: hoje
  const today = new Date().toISOString().slice(0, 10)
  await page.locator('#step_date').fill(today)
  await page.getByRole('button', { name: /adicionar etapa/i }).click()
  // Aguardar o form fechar e a etapa aparecer
  await page.waitForSelector('text=Sessão 1', { timeout: 45_000 })
  console.log('[smoke] treatment step created')

  // ---- Verificar ficha clínica ----
  const anamneseBadge = page.getByText(/anamnese/i).first()
  await expect(anamneseBadge).toBeVisible({ timeout: 10_000 })
  const queixaResposta = page.getByText('Dor lombar há 3 dias').first()
  await expect(queixaResposta).toBeVisible({ timeout: 5_000 })
  console.log('[smoke] ficha clínica shows anamnese + response')

  // ---- Relatório dos logs de erro capturados ----
  if (logs.length > 0) {
    console.log('\n=== errors captured during flow ===')
    for (const l of logs) console.log(l)
  } else {
    console.log('[smoke] no errors captured')
  }
})

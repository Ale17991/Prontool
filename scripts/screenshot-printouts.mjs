/**
 * Feature 054 — rasteriza os PDFs gerados por `preview-printouts.ts` em PNG,
 * usando o Chromium que o Playwright já baixou para os testes e2e.
 *
 * Existe porque a conferência visual (T041) é a dívida recorrente desta
 * vertical: 046, 047, 049, 050 e 052 foram a produção sem ninguém abrir o
 * arquivo. Foi este script que pegou o defeito de ordenação das colunas de
 * evolução — o impresso saía 01/08, 10/02, 12/05, e nenhum teste via, porque a
 * ordem só existe no desenho.
 *
 *   pnpm tsx scripts/preview-printouts.ts --out <pdfs>
 *   node scripts/screenshot-printouts.mjs <pdfs> <pngs> [pagina]
 *
 * `pagina` (default 1) escolhe qual folha capturar — a identificação do
 * paciente e o rodapé precisam ser conferidos na 2 em diante (FR-015).
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const [, , dir, out, pageNum = '1'] = process.argv
if (!dir || !out) {
  console.error('uso: node scripts/screenshot-printouts.mjs <pasta-pdfs> <pasta-pngs> [pagina]')
  process.exit(1)
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.pdf'))
  .sort()

// `channel: 'chromium'` pede o headless novo: o antigo não renderiza o visor de
// PDF, e a captura sairia em branco.
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 1414 } })

for (const f of files) {
  const url = 'file:///' + join(dir, f).replace(/\\/g, '/') + `#page=${pageNum}&zoom=110`
  await page.goto(url)
  await page.waitForTimeout(2500)
  const png = join(out, f.replace(/\.pdf$/, `-p${pageNum}.png`))
  await page.screenshot({ path: png })
  console.log('ok', png)
}

await browser.close()

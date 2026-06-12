const { chromium } = require('@playwright/test')
const path = require('path')

;(async () => {
  const dir = __dirname
  const htmlPath = path.join(dir, 'relatorio-precificacao.html')
  const pdfPath = path.join(dir, 'Clinni-Relatorio-Precificacao.pdf')

  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' })
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  })
  await browser.close()
  console.log('PDF gerado:', pdfPath)
})().catch((e) => { console.error(e); process.exit(1) })

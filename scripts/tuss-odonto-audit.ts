#!/usr/bin/env tsx
/**
 * Audita o catalogo TUSS odontologico local contra a publicacao oficial ANS
 * Janeiro/2025 (Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501).
 *
 * Funcionamento:
 *   1. Baixa o ZIP oficial (~341 MB) ou usa cache local em .tmp/.
 *   2. Extrai o XLSX da Tabela 22 com `adm-zip` (cross-platform — funciona
 *      em Windows sem precisar do binario `unzip`).
 *   3. Filtra codigos com prefixo 8x (odontologia).
 *   4. Compara com tuss_codes locais (tuss_table='22', code LIKE '8%').
 *   5. Imprime tabela | prefix | local | official | diff |.
 *
 * Uso:
 *   pnpm seed:tuss:audit-odonto
 *   TUSS_OFFICIAL_ZIP=/caminho/local.zip pnpm seed:tuss:audit-odonto
 *   TUSS_OFFICIAL_XLSX=/caminho/tuss22.xlsx pnpm seed:tuss:audit-odonto
 *
 * NAO importa codigos: a investigacao previa confirmou que a fonte oficial
 * tem 370 codigos odonto vs 380 locais. Prefixo 88 nao existe.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import ExcelJS from 'exceljs'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const ANS_ZIP_URL =
  'https://www.ans.gov.br/arquivos/extras/tiss/Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501.zip'

const PREFIXES = ['81', '82', '83', '84', '85', '86', '87', '88'] as const

async function main(): Promise<void> {
  const xlsxPath = await resolveXlsxPath()
  console.info(`[tuss-odonto-audit] parseando ${xlsxPath}`)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xlsxPath)
  const ws = wb.getWorksheet('Tab 22  VERSÃO 202501') ?? wb.worksheets[1]
  if (!ws) throw new Error('worksheet Tab 22 nao encontrada no XLSX')

  const officialCodes: string[] = []
  for (let r = 9; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const codigo = String(row.getCell(1).value ?? '').trim()
    if (!/^\d+$/.test(codigo)) continue
    officialCodes.push(codigo.padStart(8, '0'))
  }
  console.info(`[tuss-odonto-audit] ${officialCodes.length} codigos parseados da fonte oficial`)

  const officialByPrefix: Record<string, number> = {}
  for (const p of PREFIXES) officialByPrefix[p] = 0
  for (const code of officialCodes) {
    const p = code.slice(0, 2)
    if (PREFIXES.includes(p as typeof PREFIXES[number])) {
      officialByPrefix[p] = (officialByPrefix[p] ?? 0) + 1
    }
  }

  // Consulta locais.
  const supabase = createSupabaseServiceClient()
  const { data: locals, error } = await supabase
    .from('tuss_codes')
    .select('code')
    .eq('tuss_table', '22')
    .like('code', '8%')
  if (error) throw new Error(`consulta local falhou: ${error.message}`)

  const localCodes = ((locals ?? []) as Array<{ code: string }>).map((r) => r.code)
  const localSet = new Set(localCodes)

  const localByPrefix: Record<string, number> = {}
  for (const p of PREFIXES) localByPrefix[p] = 0
  for (const code of localCodes) {
    const p = code.slice(0, 2)
    if (PREFIXES.includes(p as typeof PREFIXES[number])) {
      localByPrefix[p] = (localByPrefix[p] ?? 0) + 1
    }
  }

  console.info('')
  console.info('[tuss-odonto-audit] === Reconciliação odonto (Tabela 22) ===')
  console.info('  prefix | local | official | diff')
  console.info('  -------|-------|----------|------')
  let totalLocal = 0
  let totalOfficial = 0
  for (const p of PREFIXES) {
    const local = localByPrefix[p] ?? 0
    const official = officialByPrefix[p] ?? 0
    totalLocal += local
    totalOfficial += official
    const diff = local - official
    const note = p === '88' && official === 0 ? '  (esperado — Tabela 22 oficial não tem 88x)' : ''
    console.info(
      `  ${p}     | ${String(local).padStart(5)} | ${String(official).padStart(8)} | ${diff >= 0 ? '+' : ''}${diff}${note}`,
    )
  }
  console.info('  -------|-------|----------|------')
  const diffTotal = totalLocal - totalOfficial
  console.info(
    `  TOTAL  | ${String(totalLocal).padStart(5)} | ${String(totalOfficial).padStart(8)} | ${diffTotal >= 0 ? '+' : ''}${diffTotal}`,
  )
  console.info('')

  const officialDentalSet = new Set(officialCodes.filter((c) => /^8/.test(c)))
  const missing = [...officialDentalSet].filter((c) => !localSet.has(c)).sort()
  const extras = [...localSet].filter((c) => !officialDentalSet.has(c)).sort()

  if (missing.length === 0) {
    console.info('[tuss-odonto-audit] 0 codigos odonto faltando vs fonte oficial.')
  } else {
    console.info(
      `[tuss-odonto-audit] ${missing.length} codigos odonto presentes na ANS oficial mas ausentes localmente:`,
    )
    for (const c of missing.slice(0, 20)) console.info(`  ${c}`)
    if (missing.length > 20) console.info(`  … (+${missing.length - 20} mais)`)
  }

  if (extras.length > 0) {
    console.info(
      `[tuss-odonto-audit] ${extras.length} codigos odonto locais nao constam na ANS oficial v202501 (provavelmente retirados pela ANS desde o snapshot inicial):`,
    )
    for (const c of extras.slice(0, 20)) console.info(`  ${c}`)
    if (extras.length > 20) console.info(`  … (+${extras.length - 20} mais)`)
  }
}

/**
 * Estrategia de resolucao do xlsx:
 *   1. TUSS_OFFICIAL_XLSX env var (caminho explicito para o xlsx).
 *   2. .tmp/tuss22.xlsx ja extraido.
 *   3. TUSS_OFFICIAL_ZIP env var ou .tmp/tuss_202501.zip (extrai com adm-zip).
 *   4. Download do ZIP oficial e extracao.
 */
async function resolveXlsxPath(): Promise<string> {
  const explicitXlsx = process.env.TUSS_OFFICIAL_XLSX
  if (explicitXlsx && existsSync(explicitXlsx)) return explicitXlsx

  const cachedXlsx = join('.tmp', 'tuss22.xlsx')
  if (existsSync(cachedXlsx)) {
    const s = await stat(cachedXlsx)
    console.info(
      `[tuss-odonto-audit] usando xlsx em cache local ${cachedXlsx} (${(s.size / 1024).toFixed(0)} KB)`,
    )
    return cachedXlsx
  }

  const cachedZipPath = process.env.TUSS_OFFICIAL_ZIP ?? join('.tmp', 'tuss_202501.zip')
  await mkdir(dirname(cachedZipPath), { recursive: true })

  if (!existsSync(cachedZipPath)) {
    console.info(`[tuss-odonto-audit] baixando ANS 202501 (~341 MB) -> ${cachedZipPath}`)
    const res = await fetch(ANS_ZIP_URL)
    if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(cachedZipPath, buf)
    console.info(
      `[tuss-odonto-audit] download concluido (${(buf.length / 1024 / 1024).toFixed(1)} MB)`,
    )
  } else {
    const s = await stat(cachedZipPath)
    console.info(
      `[tuss-odonto-audit] usando ZIP em cache local ${cachedZipPath} (${(s.size / 1024 / 1024).toFixed(1)} MB)`,
    )
  }

  // Extrai o xlsx da Tabela 22 com adm-zip — cross-platform, sem depender de
  // binario externo (Windows nao tem `unzip` nativo).
  const zip = new AdmZip(cachedZipPath)
  const entries = zip.getEntries()
  const target = entries.find((e) => {
    const name = e.entryName.toLowerCase()
    return (
      name.includes('tuss 22') &&
      name.endsWith('.xlsx') &&
      !name.startsWith('__macosx/')
    )
  })
  if (!target) {
    const list = entries
      .map((e) => e.entryName)
      .filter((n) => n.toLowerCase().endsWith('.xlsx'))
      .slice(0, 10)
      .join('\n  ')
    throw new Error(`xlsx da Tabela 22 nao encontrado no ZIP. Entradas xlsx encontradas:\n  ${list}`)
  }

  const extractDir = join(tmpdir(), `tuss-audit-${Date.now()}`)
  await mkdir(extractDir, { recursive: true })
  const outPath = join(extractDir, 'tuss22.xlsx')
  await writeFile(outPath, target.getData())
  console.info(`[tuss-odonto-audit] xlsx extraido para ${outPath}`)

  // Cache para proximas execucoes.
  await writeFile(cachedXlsx, target.getData())
  console.info(`[tuss-odonto-audit] xlsx tambem cacheado em ${cachedXlsx}`)

  return outPath
}

main().catch((err: unknown) => {
  console.error('[tuss-odonto-audit] fatal:', err)
  process.exit(1)
})

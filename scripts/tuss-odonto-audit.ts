#!/usr/bin/env tsx
/**
 * Audita o catalogo TUSS odontologico local contra a publicacao oficial ANS
 * Janeiro/2025 (Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501).
 *
 * Funcionamento:
 *   1. Baixa o ZIP oficial (~341 MB) ou usa cache local em .tmp/.
 *   2. Extrai e parsa o XLSX da Tabela 22.
 *   3. Filtra codigos com prefixo 8x (odontologia).
 *   4. Compara com tuss_codes locais (tuss_table='22', code LIKE '8%').
 *   5. Imprime tabela | prefix | local | official | diff |.
 *
 * Uso:
 *   pnpm seed:tuss:audit-odonto
 *   TUSS_OFFICIAL_ZIP=/caminho/local.zip pnpm seed:tuss:audit-odonto  # cache custom
 *
 * NAO importa codigos: a investigacao previa (commit anterior desta branch)
 * confirmou que a fonte oficial tem 370 codigos odonto vs 380 locais. Prefixo
 * 88 nao existe. Esta auditoria e diagnostica, nao corretiva.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import ExcelJS from 'exceljs'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const ANS_ZIP_URL =
  'https://www.ans.gov.br/arquivos/extras/tiss/Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501.zip'

const PREFIXES = ['81', '82', '83', '84', '85', '86', '87', '88'] as const

async function main(): Promise<void> {
  const cachedZipPath = process.env.TUSS_OFFICIAL_ZIP ?? join('.tmp', 'tuss_202501.zip')
  await mkdir(dirname(cachedZipPath), { recursive: true })

  let zipPath = cachedZipPath
  if (!existsSync(zipPath)) {
    console.info(`[tuss-odonto-audit] baixando ANS 202501 (~341 MB) -> ${zipPath}`)
    const res = await fetch(ANS_ZIP_URL)
    if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(zipPath, buf)
    console.info(`[tuss-odonto-audit] download concluido (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
  } else {
    const s = await stat(zipPath)
    console.info(`[tuss-odonto-audit] usando cache local ${zipPath} (${(s.size / 1024 / 1024).toFixed(1)} MB)`)
  }

  // Extrai apenas o XLSX da Tabela 22 — usa unzip do sistema (PowerShell tem
  // Expand-Archive; bash tem unzip). Fallback: erro com instrucoes.
  const extractDir = join(tmpdir(), `tuss-audit-${Date.now()}`)
  await mkdir(extractDir, { recursive: true })
  const extractCmd = spawnSync('unzip', [
    '-o',
    zipPath,
    'Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501/TUSS 22 - PROCEDIMENTOS E EVENTOS EM SA*.xlsx',
    '-d',
    extractDir,
  ])
  if (extractCmd.status !== 0) {
    throw new Error(
      `unzip falhou (status ${extractCmd.status}). stderr: ${extractCmd.stderr?.toString()}`,
    )
  }

  // Localiza o xlsx extraido (nome contem caracteres acentuados).
  const innerDir = join(
    extractDir,
    'Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501',
  )
  const ls = spawnSync('ls', [innerDir])
  const xlsxFile = ls.stdout
    .toString()
    .split(/\r?\n/)
    .find((f) => f.toLowerCase().includes('tuss 22') && f.endsWith('.xlsx'))
  if (!xlsxFile) throw new Error('xlsx da Tabela 22 nao encontrado apos extract')
  const xlsxPath = join(innerDir, xlsxFile)
  console.info(`[tuss-odonto-audit] parseando ${xlsxFile}`)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xlsxPath)
  const ws = wb.getWorksheet('Tab 22  VERSÃO 202501') ?? wb.worksheets[1]
  if (!ws) throw new Error('worksheet Tab 22 nao encontrada')

  const officialCodes: string[] = []
  for (let r = 9; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const codigo = String(row.getCell(1).value ?? '').trim()
    if (!/^\d+$/.test(codigo)) continue
    officialCodes.push(codigo.padStart(8, '0'))
  }

  // Conta por prefixo nos codigos oficiais.
  const officialByPrefix: Record<string, number> = {}
  for (const p of PREFIXES) officialByPrefix[p] = 0
  for (const code of officialCodes) {
    const p = code.slice(0, 2)
    if (PREFIXES.includes(p as typeof PREFIXES[number])) officialByPrefix[p] = (officialByPrefix[p] ?? 0) + 1
  }

  // Consulta locais.
  const supabase = createSupabaseServiceClient()
  const { data: locals, error } = await supabase
    .from('tuss_codes')
    .select('code')
    .eq('tuss_table', '22')
    .like('code', '8%')
  if (error) throw new Error(`consulta local falhou: ${error.message}`)

  const localByPrefix: Record<string, number> = {}
  for (const p of PREFIXES) localByPrefix[p] = 0
  for (const r of (locals ?? []) as Array<{ code: string }>) {
    const p = r.code.slice(0, 2)
    if (PREFIXES.includes(p as typeof PREFIXES[number])) localByPrefix[p] = (localByPrefix[p] ?? 0) + 1
  }

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
  console.info(`  TOTAL  | ${String(totalLocal).padStart(5)} | ${String(totalOfficial).padStart(8)} | ${totalLocal - totalOfficial >= 0 ? '+' : ''}${totalLocal - totalOfficial}`)

  const missing = officialCodes.filter((c) => /^8/.test(c)).filter((c) => {
    return !(locals ?? []).some((l: { code: string }) => l.code === c)
  })
  if (missing.length === 0) {
    console.info('[tuss-odonto-audit] 0 codigos odonto faltando vs fonte oficial.')
  } else {
    console.info(`[tuss-odonto-audit] ${missing.length} codigos odonto presentes na ANS oficial mas ausentes localmente:`)
    for (const c of missing.slice(0, 20)) console.info(`  ${c}`)
    if (missing.length > 20) console.info(`  … (+${missing.length - 20} mais)`)
  }
}

main().catch((err: unknown) => {
  console.error('[tuss-odonto-audit] fatal:', err)
  process.exit(1)
})

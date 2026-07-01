#!/usr/bin/env tsx
/**
 * Dry-run do seed-cid10: baixa a fonte, parseia, mostra estatísticas
 * (total de códigos, top 5 primeiros, top 5 últimos) sem escrever no
 * banco. Útil pra validar a fonte antes de rodar o seed real.
 *
 * Uso: pnpm exec tsx scripts/seed-cid10-dryrun.ts
 *      CID10_SOURCE_URL=<url> pnpm exec tsx scripts/seed-cid10-dryrun.ts
 */

const DEFAULT_URL =
  process.env.CID10_SOURCE_URL ??
  'https://raw.githubusercontent.com/cleytonferrari/CidDataSus/master/CIDImport/Repositorio/Resources/CID-10-SUBCATEGORIAS.CSV'

interface NormalizedRow {
  code: string
  description: string
  chapter: string | null
}

async function main(): Promise<void> {
  console.info(`[dryrun] baixando ${DEFAULT_URL}…`)
  const res = await fetch(DEFAULT_URL)
  if (!res.ok) {
    throw new Error(`failed to download ${DEFAULT_URL}: HTTP ${res.status}`)
  }
  const isCsv =
    /\.csv($|\?)/i.test(DEFAULT_URL) || (res.headers.get('content-type') ?? '').includes('csv')

  let normalized: NormalizedRow[]
  if (isCsv) {
    const buf = await res.arrayBuffer()
    const utf8 = new TextDecoder('utf-8').decode(buf)
    const isUtf8Broken = utf8.includes('�')
    const text = isUtf8Broken ? new TextDecoder('latin1').decode(buf) : utf8
    console.info(
      `[dryrun] baixou ${(buf.byteLength / 1024).toFixed(1)} KB · ${
        isUtf8Broken ? 'latin1' : 'utf-8'
      }`,
    )
    normalized = parseDataSusCsv(text)
  } else {
    const raw = await res.text()
    console.info(`[dryrun] baixou ${(raw.length / 1024).toFixed(1)} KB · JSON`)
    normalized = parseJson(raw)
  }

  console.info(`[dryrun] total: ${normalized.length} códigos únicos`)
  console.info('[dryrun] primeiros 5:')
  for (const r of normalized.slice(0, 5)) {
    console.info(`  ${r.code}  ${r.description}`)
  }
  console.info('[dryrun] últimos 5:')
  for (const r of normalized.slice(-5)) {
    console.info(`  ${r.code}  ${r.description}`)
  }

  // Sanity checks
  const hasJ06 = normalized.find((r) => r.code === 'J06.9')
  if (hasJ06) console.info(`[dryrun] sanity J06.9 → ${hasJ06.description}`)
  const hasI10 = normalized.find((r) => r.code === 'I10')
  if (hasI10) console.info(`[dryrun] sanity I10 → ${hasI10.description}`)
}

function parseDataSusCsv(text: string): NormalizedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0]!.split(';').map((s) => s.trim().toUpperCase())
  const codeIdx = pickIndex(header, ['SUBCAT', 'CATEGORIA', 'CODIGO', 'CODE'])
  const descIdx = pickIndex(header, ['DESCRICAO', 'DESCRIPTION'])
  if (codeIdx < 0 || descIdx < 0) {
    throw new Error(`CSV header sem código/descrição: ${header.join(', ')}`)
  }
  const seen = new Map<string, NormalizedRow>()
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(';')
    const rawCode = (cols[codeIdx] ?? '').trim().toUpperCase()
    const description = (cols[descIdx] ?? '').trim()
    if (!rawCode || !description) continue
    const code = formatCidCode(rawCode)
    if (!code) continue
    seen.set(code, { code, description, chapter: null })
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

function formatCidCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, '').replace(/\./g, '').toUpperCase()
  if (cleaned.length < 3) return null
  if (cleaned.length === 3) return cleaned
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3)}`
}

function pickIndex(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.indexOf(c)
    if (idx >= 0) return idx
  }
  return -1
}

function parseJson(raw: string): NormalizedRow[] {
  interface SourceRow {
    codigo?: string
    code?: string
    descricao?: string
    description?: string
    capitulo?: string | null
    chapter?: string | null
  }
  const json = JSON.parse(raw) as SourceRow[] | { rows: SourceRow[] }
  const rows = Array.isArray(json) ? json : json.rows
  const seen = new Map<string, NormalizedRow>()
  for (const r of rows) {
    const rawCode = (r.codigo ?? r.code ?? '').toString().trim().toUpperCase()
    const description = (r.descricao ?? r.description ?? '').toString().trim()
    if (!rawCode || !description) continue
    const code = rawCode.includes('.') ? rawCode : formatCidCode(rawCode)
    if (!code) continue
    const chapter = ((r.capitulo ?? r.chapter ?? null) || null) as string | null
    seen.set(code, { code, description, chapter })
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

main().catch((err: unknown) => {
  console.error('[dryrun] fatal:', err)
  process.exit(1)
})

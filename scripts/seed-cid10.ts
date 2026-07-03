#!/usr/bin/env tsx
/**
 * Importa o catálogo CID-10 (Classificação Estatística Internacional de
 * Doenças e Problemas Relacionados à Saúde, 10ª revisão) para
 * `cid10_codes`. Dado público da OMS / DataSUS — adoção brasileira.
 *
 * Fonte default: cleytonferrari/CidDataSus, arquivo CID-10-SUBCATEGORIAS.CSV
 * (~14k códigos no nível mais detalhado, formato DataSUS). Header:
 *   SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;
 * Códigos vêm sem ponto (A000) — convertemos pra formato canônico A00.0.
 *
 * Override via env CID10_SOURCE_URL apontando pra:
 *   - .csv com separador `;` e header DataSUS (SUBCAT/DESCRICAO)
 *   - .json com array de { codigo|code, descricao|description, capitulo|chapter? }
 * Detectado por extensão da URL ou content-type.
 *
 * Uso:
 *   pnpm seed:cid10                               # local (.env.local)
 *   pnpm seed:cid10:prod                          # prod (.env.production.local)
 *   CID10_SOURCE_URL=<url> pnpm seed:cid10        # override
 */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const DEFAULT_URL =
  process.env.CID10_SOURCE_URL ??
  'https://raw.githubusercontent.com/cleytonferrari/CidDataSus/master/CIDImport/Repositorio/Resources/CID-10-SUBCATEGORIAS.CSV'

interface NormalizedRow {
  code: string
  description: string
  chapter: string | null
}

async function main(): Promise<void> {
  console.info(`[seed-cid10] baixando ${DEFAULT_URL}…`)
  const res = await fetch(DEFAULT_URL)
  if (!res.ok) throw new Error(`failed to download ${DEFAULT_URL}: HTTP ${res.status}`)

  const isCsv =
    /\.csv($|\?)/i.test(DEFAULT_URL) || (res.headers.get('content-type') ?? '').includes('csv')

  let normalized: NormalizedRow[]
  if (isCsv) {
    const buf = await res.arrayBuffer()
    // O arquivo do DataSUS é Latin-1/Windows-1252 (acentos como É, Á). Tenta
    // detectar: se TextDecoder utf-8 produz "replacement char" em descrições,
    // refaz com latin1.
    const utf8 = new TextDecoder('utf-8').decode(buf)
    const isUtf8Broken = utf8.includes('�')
    const text = isUtf8Broken ? new TextDecoder('latin1').decode(buf) : utf8
    console.info(
      `[seed-cid10] baixou ${(buf.byteLength / 1024).toFixed(1)} KB — parsing CSV (${
        isUtf8Broken ? 'latin1' : 'utf-8'
      })`,
    )
    normalized = parseDataSusCsv(text)
  } else {
    const raw = await res.text()
    console.info(`[seed-cid10] baixou ${(raw.length / 1024).toFixed(1)} KB — parsing JSON`)
    normalized = parseJson(raw)
  }

  console.info(`[seed-cid10] parseou ${normalized.length} códigos únicos`)
  if (normalized.length === 0) {
    console.error('[seed-cid10] ABORTADO: parse retornou 0 códigos. Verifique a fonte.')
    process.exit(2)
  }

  const supabase = createSupabaseServiceClient()
  const BATCH = 1000
  for (let i = 0; i < normalized.length; i += BATCH) {
    const slice = normalized.slice(i, i + BATCH)
    const { error } = await supabase.from('cid10_codes').upsert(slice, { onConflict: 'code' })
    if (error) throw new Error(`cid10_codes upsert offset=${i}: ${error.message}`)
    console.info(
      `[seed-cid10] upsert ${Math.min(i + BATCH, normalized.length)}/${normalized.length}`,
    )
  }

  console.info('[seed-cid10] concluído.')
}

/**
 * Parse do CSV do DataSUS. Header: SUBCAT;...;DESCRICAO;DESCRABREV;...
 * Aceita também CATEGORIA (3 chars, ex.: A00) caso a fonte traga essa lista.
 */
function parseDataSusCsv(text: string): NormalizedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const header = lines[0]!.split(';').map((s) => s.trim().toUpperCase())
  const codeIdx = pickIndex(header, ['SUBCAT', 'CATEGORIA', 'CODIGO', 'CODE'])
  const descIdx = pickIndex(header, ['DESCRICAO', 'DESCRIPTION'])
  if (codeIdx < 0 || descIdx < 0) {
    throw new Error(`CSV sem coluna de código ou descrição. Headers: ${header.join(', ')}`)
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

/** Insere ponto após o 3º caractere quando o código tem 4+ chars. A000 → A00.0 */
function formatCidCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, '').replace(/\./g, '').toUpperCase()
  if (cleaned.length < 3) return null
  if (cleaned.length === 3) return cleaned // categoria: A00
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3)}`
}

function pickIndex(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.indexOf(c)
    if (idx >= 0) return idx
  }
  return -1
}

/** Fallback pra fontes JSON (override via CID10_SOURCE_URL). */
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
  if (!Array.isArray(rows)) {
    throw new Error('JSON sem array (esperado SourceRow[] ou { rows: SourceRow[] })')
  }
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
  console.error('[seed-cid10] fatal:', err)
  process.exit(1)
})

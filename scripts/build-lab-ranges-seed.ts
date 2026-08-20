/**
 * Feature 050 — semeia `lab_reference_ranges` a partir da aba `BD_Exames` da
 * Evonut. Catálogo global (sem tenant_id). Idempotente: apaga e reinsere.
 *
 *   DRY=1 tsx scripts/build-lab-ranges-seed.ts
 *   tsx --env-file=.env.local            scripts/build-lab-ranges-seed.ts
 *   tsx --env-file=.env.production.local scripts/build-lab-ranges-seed.ts
 *
 * Notas de fonte (levantadas no research.md D9):
 *  - a aba `BD EXAMES_1` do AF tem unidade e faixas 100% VAZIAS — não serve de
 *    gabarito; a fonte é só a Evonut;
 *  - o recorte é apenas por SEXO (colunas H/M). Não há faixa etária nem estado
 *    gestacional na fonte, então tudo é semeado como 0–130 / 'padrao'. O schema
 *    e o lookup já suportam os três eixos: quando entrar uma fonte pediátrica,
 *    basta inserir linhas mais específicas, sem mudar código;
 *  - ~200 das 319 linhas são exames QUALITATIVOS (sem valor numérico) e 22 são
 *    pseudo-exames do grupo "Exames Completos" (atalhos de painel de pedido).
 *    Ambos ficam fora — o motor classifica número contra faixa;
 *  - `0` como limite é ruído da planilha (nem piso 0 nem teto 0 dizem algo
 *    clinicamente) e é lido como "sem limite", igual ao build-dris-seed.
 */
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import {
  ANALYTE_BY_NAME,
  ANALYTE_BY_SOURCE_COD,
  labAnalyte,
  normalizeAnalyteName,
} from '@/lib/core/labs/catalog'
import { normalizeUnit } from '@/lib/core/labs/units'

const FILE = 'nutri-doc/Evonut.xlsm'
const SHEET = 'BD_Exames'
const SOURCE_LABEL = 'BD_Exames (Evonut)'
const DRY = process.env.DRY === '1'

/** Colunas 1-based da aba (header na linha 3, dados a partir da 4). */
const COL = { cod: 1, name: 2, group: 3, unit: 4, minH: 5, maxH: 6, minM: 7, maxM: 8 } as const

function txt(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; text?: string; result?: unknown }
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('')
    if (typeof o.text === 'string') return o.text
    if (o.result !== undefined) return txt(o.result)
    return ''
  }
  return String(v)
}

/** "* 210,00" → 210. Vazio, "-" e 0 → null (sem limite). */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0 ? v : null
  const s = txt(v).replace(/\*/g, '').replace(/\s/g, '').replace(',', '.')
  if (!s || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) && n !== 0 ? n : null
}

interface RangeRow {
  analyte_key: string
  sex: 'M' | 'F' | 'any'
  age_min_years: number
  age_max_years: number
  state: 'padrao'
  ref_min: number | null
  ref_max: number | null
  unit: string
  source_label: string
}

interface Parsed {
  rows: RangeRow[]
  stats: {
    total: number
    qualitativos: number
    painelCompleto: number
    naoMapeados: string[]
    unidadesDesconhecidas: string[]
    divergemPorSexo: number
    unidadeDivergeDoCatalogo: string[]
  }
}

async function parse(): Promise<Parsed> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    entries: 'emit',
  })

  const rows: RangeRow[] = []
  const seen = new Set<string>()
  const stats: Parsed['stats'] = {
    total: 0,
    qualitativos: 0,
    painelCompleto: 0,
    naoMapeados: [],
    unidadesDesconhecidas: [],
    divergemPorSexo: 0,
    unidadeDivergeDoCatalogo: [],
  }

  let found = false
  for await (const ws of wb) {
    if ((ws as unknown as { name?: string }).name !== SHEET) {
      for await (const _ of ws) void _
      continue
    }
    found = true
    for await (const row of ws) {
      if (row.number < 4) continue
      const name = txt(row.getCell(COL.name).value).trim()
      if (!name) continue
      stats.total++

      const group = txt(row.getCell(COL.group).value).trim()
      if (group === 'Exames Completos') {
        stats.painelCompleto++
        continue
      }

      const minH = num(row.getCell(COL.minH).value)
      const maxH = num(row.getCell(COL.maxH).value)
      const minM = num(row.getCell(COL.minM).value)
      const maxM = num(row.getCell(COL.maxM).value)
      const rawUnit = txt(row.getCell(COL.unit).value).trim()
      if (!rawUnit || (minH === null && maxH === null && minM === null && maxM === null)) {
        stats.qualitativos++
        continue
      }

      // Homônimos (cálcio total vs iônico) se resolvem pelo Cod, não pelo nome.
      const cod = num(row.getCell(COL.cod).value)
      const key =
        (cod !== null ? ANALYTE_BY_SOURCE_COD.get(cod) : undefined) ??
        ANALYTE_BY_NAME.get(normalizeAnalyteName(name))
      if (!key) {
        stats.naoMapeados.push(`${name} (${group})`)
        continue
      }

      let unit: string
      try {
        unit = normalizeUnit(rawUnit)
      } catch {
        stats.unidadesDesconhecidas.push(`${rawUnit} (${name})`)
        continue
      }

      // A comparação valor × faixa assume unidade única por analito (não há
      // conversão no v1): divergir do catálogo é erro, não aviso.
      const def = labAnalyte(key)
      if (def && def.unit !== unit) {
        stats.unidadeDivergeDoCatalogo.push(`${key}: catálogo ${def.unit} vs planilha ${unit}`)
        continue
      }

      const same = minH === minM && maxH === maxM
      if (!same) stats.divergemPorSexo++

      const push = (sex: RangeRow['sex'], lo: number | null, hi: number | null) => {
        if (lo === null && hi === null) return
        const dedupe = `${key}|${sex}`
        if (seen.has(dedupe)) return // a planilha repete o analito em vários grupos
        seen.add(dedupe)
        rows.push({
          analyte_key: key,
          sex,
          age_min_years: 0,
          age_max_years: 130,
          state: 'padrao',
          ref_min: lo,
          ref_max: hi,
          unit,
          source_label: SOURCE_LABEL,
        })
      }

      if (same) push('any', minH, maxH)
      else {
        push('M', minH, maxH)
        push('F', minM, maxM)
      }
    }
  }

  if (!found) throw new Error(`aba "${SHEET}" não encontrada em ${FILE}`)
  return { rows, stats }
}

async function main() {
  const { rows, stats } = await parse()
  const analitos = new Set(rows.map((r) => r.analyte_key))

  console.log(`linhas na planilha:            ${stats.total}`)
  console.log(`  descartadas: qualitativas    ${stats.qualitativos}`)
  console.log(`  descartadas: "Exames Completos" ${stats.painelCompleto}`)
  console.log(`faixas geradas:                ${rows.length}`)
  console.log(`analitos cobertos:             ${analitos.size}`)
  console.log(`  divergindo por sexo:         ${stats.divergemPorSexo}`)
  console.log(`  só com teto (≤ X):           ${rows.filter((r) => r.ref_min === null).length}`)
  console.log(`  só com piso (≥ X):           ${rows.filter((r) => r.ref_max === null).length}`)

  // Estes três NÃO podem ficar em silêncio: significam que a fonte mudou.
  let fatal = false
  for (const [label, list] of [
    ['nomes não mapeados no catálogo', stats.naoMapeados],
    ['unidades desconhecidas', stats.unidadesDesconhecidas],
    ['unidade divergente do catálogo', stats.unidadeDivergeDoCatalogo],
  ] as const) {
    if (!list.length) continue
    fatal = true
    console.error(`\n!! ${list.length} ${label}:`)
    for (const x of list) console.error(`   - ${x}`)
  }
  if (fatal) {
    console.error('\nCorrija src/lib/core/labs/catalog.ts ou units.ts antes de semear.')
    process.exit(1)
  }

  if (DRY) return console.log('\n[DRY] nada gravado.')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('env faltando: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
    return
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const del = await sb.from('lab_reference_ranges').delete().not('id', 'is', null)
  if (del.error) {
    console.error('delete falhou:', del.error.message)
    process.exit(1)
    return
  }
  const CHUNK = 500
  let n = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb
      .from('lab_reference_ranges')
      .insert(rows.slice(i, i + CHUNK) as never)
    if (error) {
      console.error('insert falhou:', error.message)
      process.exit(1)
      return
    }
    n += Math.min(CHUNK, rows.length - i)
  }
  console.log(`\ngravadas ${n} faixas.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

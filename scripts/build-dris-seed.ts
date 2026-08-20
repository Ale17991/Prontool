/**
 * Feature 049 US2 — semeia `dietary_reference_intakes` a partir da aba `BD_DRIs`
 * da Evonut (bloco RDA/AI). Catálogo global (tenant_id NULL). Idempotente:
 * apaga e reinsere.
 *
 *   DRY=1 tsx scripts/build-dris-seed.ts
 *   tsx --env-file=.env.local            scripts/build-dris-seed.ts
 *   tsx --env-file=.env.production.local scripts/build-dris-seed.ts
 */
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { MICRONUTRIENTS } from '@/lib/core/nutrition/micronutrients'

const FILE = 'nutri-doc/Evonut.xlsm'
const DRY = process.env.DRY === '1'

// Colunas do bloco RDA/AI (getCell 1-based) → (sexo, faixa etária, estado).
const RDA_COLS = [
  { col: 41, sex: 'any', min: 0, max: 0.5, state: 'padrao' },
  { col: 42, sex: 'any', min: 0.5, max: 1, state: 'padrao' },
  { col: 43, sex: 'any', min: 1, max: 3, state: 'padrao' },
  { col: 44, sex: 'any', min: 4, max: 8, state: 'padrao' },
  { col: 45, sex: 'M', min: 9, max: 13, state: 'padrao' },
  { col: 46, sex: 'M', min: 14, max: 18, state: 'padrao' },
  { col: 47, sex: 'M', min: 19, max: 30, state: 'padrao' },
  { col: 48, sex: 'M', min: 31, max: 50, state: 'padrao' },
  { col: 49, sex: 'M', min: 51, max: 70, state: 'padrao' },
  { col: 50, sex: 'M', min: 71, max: 130, state: 'padrao' },
  { col: 51, sex: 'F', min: 9, max: 13, state: 'padrao' },
  { col: 52, sex: 'F', min: 14, max: 18, state: 'padrao' },
  { col: 53, sex: 'F', min: 19, max: 30, state: 'padrao' },
  { col: 54, sex: 'F', min: 31, max: 50, state: 'padrao' },
  { col: 55, sex: 'F', min: 51, max: 70, state: 'padrao' },
  { col: 56, sex: 'F', min: 71, max: 130, state: 'padrao' },
  { col: 57, sex: 'F', min: 14, max: 18, state: 'gestante' },
  { col: 58, sex: 'F', min: 19, max: 30, state: 'gestante' },
  { col: 59, sex: 'F', min: 31, max: 50, state: 'gestante' },
] as const

// Nome do nutriente na planilha → driKey. Ordem importa: b12/b6/b3/b2 antes de b1.
const NAME_TO_DRIKEY: [string, string][] = [
  ['cálcio', 'calcio'],
  ['magnésio', 'magnesio'],
  ['manganês', 'manganes'],
  ['fósforo', 'fosforo'],
  ['ferro', 'ferro'],
  ['sódio', 'sodio'],
  ['potássio', 'potassio'],
  ['cobre', 'cobre'],
  ['zinco', 'zinco'],
  ['selênio', 'selenio'],
  ['vitamina a', 'vitamina_a'],
  ['vitamina b12', 'vitamina_b12'],
  ['vitamina b6', 'vitamina_b6'],
  ['vitamina b3', 'vitamina_b3'],
  ['vitamina b2', 'vitamina_b2'],
  ['vitamina b1', 'vitamina_b1'],
  ['folato', 'folato'],
  ['vitamina c', 'vitamina_c'],
  ['vitamina d', 'vitamina_d'],
  ['vitamina e', 'vitamina_e'],
  ['fibra', 'fibra'],
]

function txt(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText))
      return (o.richText as { text: string }[]).map((r) => r.text).join('')
    if ('text' in o) return String(o.text)
    if ('result' in o) return txt(o.result)
    return ''
  }
  return String(v)
}
// "* 210,00" / "9.1" / "1300" → número; 0/vazio → null (sem DRI naquela faixa).
function num(v: unknown): number | null {
  let s = txt(v).replace(/[*\s]/g, '').replace(',', '.').trim()
  if (!s || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}
function driKeyFor(name: string): string | null {
  const n = name.toLowerCase()
  for (const [pat, key] of NAME_TO_DRIKEY) if (n.includes(pat)) return key
  return null
}
function unitFor(driKey: string): string {
  const m = MICRONUTRIENTS.find((x) => x.driKey === driKey)
  if (m) return m.unit
  return 'g' // fibra e macros
}

interface DriRow {
  nutrient_key: string
  sex: string
  age_min_years: number
  age_max_years: number
  state: string
  value: number
  unit: string
  source_label: string
}

async function parse(): Promise<DriRow[]> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    entries: 'emit',
  })
  const rows: DriRow[] = []
  for await (const ws of wb) {
    if ((ws as unknown as { name?: string }).name !== 'BD_DRIs') {
      for await (const _ of ws) void _
      continue
    }
    for await (const row of ws) {
      if (row.number < 3) continue // r1/r2 cabeçalhos
      const name = txt(row.getCell(2).value).trim()
      const driKey = name ? driKeyFor(name) : null
      if (!driKey) continue
      const unit = unitFor(driKey)
      for (const c of RDA_COLS) {
        const value = num(row.getCell(c.col).value)
        if (value === null) continue
        rows.push({
          nutrient_key: driKey,
          sex: c.sex,
          age_min_years: c.min,
          age_max_years: c.max,
          state: c.state,
          value,
          unit,
          source_label: 'DRI/IOM (BD_DRIs Evonut)',
        })
      }
    }
  }
  return rows
}

async function main() {
  const rows = await parse()
  const nutrients = new Set(rows.map((r) => r.nutrient_key))
  console.log(
    `DRIs: ${rows.length} linhas, ${nutrients.size} nutrientes (${[...nutrients].join(', ')})`,
  )
  if (DRY) return console.log('\n[DRY] nada gravado.')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return (console.error('env faltando'), process.exit(1))
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const del = await sb.from('dietary_reference_intakes').delete().not('id', 'is', null)
  if (del.error) return (console.error('delete falhou:', del.error.message), process.exit(1))
  const CHUNK = 500
  let n = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb
      .from('dietary_reference_intakes')
      .insert(rows.slice(i, i + CHUNK) as never)
    if (error) return (console.error('insert falhou:', error.message), process.exit(1))
    n += Math.min(CHUNK, rows.length - i)
  }
  console.log(`OK: ${n} DRIs semeadas.`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})

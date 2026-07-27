/**
 * Feature 049 US1 — importa a aba `BD ALIMENTOS` de `nutri-doc/AF..xlsm` como
 * base GLOBAL de alimentos com micronutrientes (`tenant_id NULL`,
 * `source='af_bdalimentos'`), coexistindo com a base TACO/POF.
 *
 *   DRY=1 tsx scripts/build-foods-micros.ts                          # só parseia/reporta
 *   tsx --env-file=.env.local scripts/build-foods-micros.ts          # grava (local)
 *   tsx --env-file=.env.production.local scripts/build-foods-micros.ts
 *
 * Idempotente: apaga os globais `af_bdalimentos` e reinsere. Valores por 100 g.
 */
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { MICRONUTRIENTS } from '@/lib/core/nutrition/micronutrients'

const FILE = 'nutri-doc/AF..xlsm'
const SOURCE = 'af_bdalimentos'
const DRY = process.env.DRY === '1'

function txt(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('')
    if ('text' in o) return String(o.text)
    if ('result' in o) return txt(o.result)
    return ''
  }
  return String(v)
}
function num(v: unknown): number | null {
  const s = txt(v).replace(',', '.').trim()
  if (!s || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

interface FoodRow {
  source: string
  external_code: string
  name: string
  reference_grams: number
  energy_kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  fiber_g: number | null
  micronutrients: Record<string, number> | null
  active: boolean
  tenant_id: null
}

async function parse(): Promise<FoodRow[]> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    entries: 'emit',
  })
  const rows: FoodRow[] = []
  for await (const ws of wb) {
    if ((ws as unknown as { name?: string }).name !== 'BD ALIMENTOS') {
      for await (const _ of ws) void _
      continue
    }
    for await (const row of ws) {
      if (row.number < 4) continue // r1-r3 = cabeçalhos
      const g = (c: number) => row.getCell(c).value
      const name = txt(g(2)).trim()
      const kcal = num(g(5))
      if (!name || kcal === null) continue
      const refG = num(g(4)) ?? 100
      const micros: Record<string, number> = {}
      for (const m of MICRONUTRIENTS) {
        const v = num(g(m.col))
        if (v !== null) micros[m.key] = v
      }
      rows.push({
        source: SOURCE,
        external_code: txt(g(1)).trim() || String(rows.length + 1),
        name,
        reference_grams: refG,
        energy_kcal: kcal,
        protein_g: num(g(6)) ?? 0,
        fat_g: num(g(7)) ?? 0, // BD ALIMENTOS: [7]=LIPÍDEOS, [8]=CARBOIDRATO
        carb_g: num(g(8)) ?? 0,
        fiber_g: num(g(9)),
        micronutrients: Object.keys(micros).length ? micros : null,
        active: true,
        tenant_id: null,
      })
    }
  }
  return rows
}

async function main() {
  const rows = await parse()
  const comMicros = rows.filter((r) => r.micronutrients).length
  console.log(`BD ALIMENTOS: ${rows.length} alimentos parseados, ${comMicros} com ao menos 1 micro.`)
  if (DRY) {
    console.log('exemplo:', JSON.stringify(rows[0], null, 0).slice(0, 400))
    return console.log('\n[DRY] nada gravado.')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return console.error('env faltando'), process.exit(1)
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Idempotência: remove os globais desta origem e reinsere.
  const del = await sb.from('foods').delete().is('tenant_id', null).eq('source', SOURCE)
  if (del.error) return console.error('delete falhou:', del.error.message), process.exit(1)

  let inserted = 0
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    const { error } = await sb.from('foods').insert(batch as never)
    if (error) {
      console.error(`insert falhou no lote ${i}-${i + batch.length}:`, error.message)
      process.exit(1)
    }
    inserted += batch.length
    console.log(`  inseridos ${inserted}/${rows.length}`)
  }
  console.log(`\nOK: ${inserted} alimentos globais '${SOURCE}' com micros.`)
  console.log('Lembrar: refazer catalog_baseline.foods se for rodar vitest local depois.')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})

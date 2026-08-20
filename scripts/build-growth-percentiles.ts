/**
 * Seed das curvas de crescimento (OMS) a partir de `nutri-doc/Evonut.xlsm`,
 * aba `BD_Percentis`.
 *
 * A aba põe SEIS blocos lado a lado, cada um com 13 colunas de passo:
 * uma coluna "idade (meses)", nove de percentil (0,1 · 3 · 5 · 10 · 15 · 50 ·
 * 85 · 97 · 99,9) e três em branco de separação. A ordem dos blocos é fixa e
 * está declarada em BLOCKS abaixo — se a planilha mudar de ordem, o seed grava
 * curva trocada em silêncio, então o script confere o TÍTULO de cada bloco
 * contra o esperado e aborta na divergência.
 *
 * O arquivo tem ~7 MB e estoura o heap no `readFile` — daí a leitura em
 * streaming.
 *
 * Uso: pnpm seed:growth       (local)
 *      pnpm seed:growth:prod  (produção, usa .env.production.local)
 */
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const FILE = 'nutri-doc/Evonut.xlsm'
const SHEET = 'BD_Percentis'
const STRIDE = 13
/** Coluna (0-based no array de células) onde começa o primeiro bloco. */
const FIRST_COL = 1

type Indicator = 'peso_idade' | 'estatura_idade' | 'imc_idade'

interface Block {
  indicator: Indicator
  sex: 'M' | 'F'
  /** Trecho que o título da planilha DEVE conter — trava contra troca de ordem. */
  expect: string[]
}

const BLOCKS: Block[] = [
  { indicator: 'peso_idade', sex: 'M', expect: ['PESO/IDADE', 'MENINOS'] },
  { indicator: 'peso_idade', sex: 'F', expect: ['PESO/IDADE', 'MENINAS'] },
  { indicator: 'estatura_idade', sex: 'M', expect: ['ESTATURA/IDADE', 'MENINOS'] },
  { indicator: 'estatura_idade', sex: 'F', expect: ['ESTATURA/IDADE', 'MENINAS'] },
  { indicator: 'imc_idade', sex: 'M', expect: ['IMC/IDADE', 'MENINOS'] },
  { indicator: 'imc_idade', sex: 'F', expect: ['IMC/IDADE', 'MENINAS'] },
]

const COLS = ['p01', 'p3', 'p5', 'p10', 'p15', 'p50', 'p85', 'p97', 'p999'] as const

interface Row {
  indicator: Indicator
  sex: 'M' | 'F'
  age_months: number
  p01: number
  p3: number
  p5: number
  p10: number
  p15: number
  p50: number
  p85: number
  p97: number
  p999: number
}

function cellNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return cellNum(o.result)
    return null
  }
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return String(o.result ?? '')
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('')
    if ('text' in o) return String(o.text ?? '')
  }
  return String(v)
}

async function extract(): Promise<Row[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {})
  const rows: Row[] = []

  for await (const ws of reader) {
    const name = (ws as unknown as { name: string }).name
    if (name !== SHEET) {
      for await (const _ of ws) void _
      continue
    }

    let checkedHeader = false
    for await (const row of ws) {
      const cells = (row.values as unknown[]).slice(1)

      if (row.number === 1) {
        // Confere que cada bloco está onde se espera. Curva trocada seria erro
        // clínico silencioso — melhor abortar o seed.
        BLOCKS.forEach((b, i) => {
          const title = cellText(cells[FIRST_COL + i * STRIDE - 1]).toUpperCase()
          for (const token of b.expect) {
            if (!title.includes(token)) {
              throw new Error(
                `Bloco ${i} esperava "${b.expect.join(' ')}" mas o título é "${title}". ` +
                  'A planilha mudou de ordem — conferir antes de semear.',
              )
            }
          }
        })
        checkedHeader = true
        continue
      }
      if (row.number <= 2) continue

      BLOCKS.forEach((b, i) => {
        const base = FIRST_COL + i * STRIDE
        const age = cellNum(cells[base])
        if (age === null || age < 0 || age > 240) return
        const values = COLS.map((_, k) => cellNum(cells[base + 1 + k]))
        // Linha incompleta não entra: um percentil faltando produziria faixa
        // aberta e classificaria criança errada.
        if (values.some((v) => v === null)) return
        const rec = { indicator: b.indicator, sex: b.sex, age_months: Math.round(age) } as Row
        COLS.forEach((c, k) => {
          ;(rec as unknown as Record<string, number>)[c] = values[k]!
        })
        rows.push(rec)
      })
    }
    if (!checkedHeader) throw new Error('Cabeçalho da aba não foi lido.')
  }
  return rows
}

function envFromFile(path: string): Record<string, string> {
  if (!fs.existsSync(path)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ''),
        ]
      }),
  )
}

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod')
  const env = { ...envFromFile(prod ? '.env.production.local' : '.env.local'), ...process.env }
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')

  const rows = await extract()
  console.log(`[growth] extraídas ${rows.length} linhas de ${FILE}`)
  for (const b of BLOCKS) {
    const n = rows.filter((r) => r.indicator === b.indicator && r.sex === b.sex).length
    console.log(`  ${b.indicator} ${b.sex}: ${n} meses`)
  }
  if (rows.length === 0) throw new Error('Nada extraído — abortando.')

  const sb = createClient(url, key, { auth: { persistSession: false } })
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await sb
      .from('growth_percentiles')
      .upsert(slice as never, { onConflict: 'indicator,sex,age_months' })
    if (error) throw new Error(`upsert: ${error.message}`)
    console.log(`[growth] ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
  }
  console.log('[growth] concluído.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

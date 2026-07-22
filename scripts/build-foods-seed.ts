/**
 * Gera o bloco SQL de seed do catálogo global de alimentos (feature 047) a
 * partir dos CSVs oficiais e injeta na migration 0176 no marcador
 * `<<< SEED_FOODS_COPY >>>`.
 *
 * Fontes (ver specs/047/research.md D1):
 *  - IBGE/POF 2008-2009 composição + medidas caseiras (espinha dorsal; é a
 *    única base pública com medida caseira de licença utilizável).
 *  - TACO 4ª ed. (NEPA/UNICAMP, 2011) — análise laboratorial brasileira.
 *
 * Estratégia de seed: staging temporário por (source, external_code) → INSERT
 * nas tabelas reais resolvendo o grupo por slug e as medidas por join no
 * external_code. Assim as medidas referenciam o alimento sem depender de UUID.
 *
 * Uso: pnpm tsx scripts/build-foods-seed.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRATCH =
  'C:/Users/alefe/AppData/Local/Temp/claude/C--My-project/880268cb-8a03-41bb-97b2-148806ca79d0/scratchpad'
const MIGRATION = join(process.cwd(), 'supabase/migrations/0176_food_catalog_and_diet_plan.sql')
const MARKER = '-- <<< SEED_FOODS_COPY >>>'

// --------------------------------------------------------------------------
// CSV mínimo (aspas + vírgula dentro de campo). Retorna array de arrays.
// --------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Número tolerante: `-`, vazio, vírgula decimal → number|null. */
function n(s: string | undefined): number | null {
  if (s === undefined) return null
  const t = s.trim()
  if (t === '' || t === '-') return null
  const v = Number(t.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

/** Clamp anti-CHECK (a base oficial às vezes estoura 100 g/100 g por arredondamento). */
function clamp(v: number | null, min: number, max: number): number | null {
  if (v === null) return null
  return Math.min(max, Math.max(min, v))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Energia por Atwater quando a base não informa (FR-007). */
function atwater(p: number, c: number, f: number): number {
  return 4 * p + 4 * c + 9 * f
}

/** Título de exibição: "ARROZ INTEGRAL" → "Arroz integral". */
function titleize(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

interface FoodRow {
  source: string
  external_code: string
  name: string
  group_slug: string
  reference_grams: number
  energy_kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  fiber_g: number | null
}
interface MeasureRow {
  source: string
  food_external_code: string
  label: string
  grams: number
  is_default: boolean
}

// --------------------------------------------------------------------------
// TACO categoria → slug dos grupos (os 11 seedados na migration)
// --------------------------------------------------------------------------
const TACO_GROUP: Record<string, string> = {
  'Cereais e derivados': 'cereais_paes',
  'Verduras, hortaliças e derivados': 'verduras',
  'Frutas e derivados': 'frutas',
  'Gorduras e óleos': 'oleos_gorduras',
  'Pescados e frutos do mar': 'carnes_ovos',
  'Carnes e derivados': 'carnes_ovos',
  'Aves e derivados': 'carnes_ovos',
  'Ovos e derivados': 'carnes_ovos',
  'Leite e derivados': 'leite_deriv',
  'Bebidas (alcoólicas e não alcoólicas)': 'bebidas',
  'Leguminosas e derivados': 'leguminosas',
  'Nozes e sementes': 'oleaginosas',
  'Miscelâneas': 'outros',
  'Outros alimentos industrializados': 'outros',
  'Alimentos preparados': 'outros',
  'Produtos açucarados': 'acucares',
}

const foods: FoodRow[] = []
const measures: MeasureRow[] = []
const seen = new Set<string>() // (source, external_code) dedup

function pushFood(f: FoodRow) {
  const key = `${f.source}::${f.external_code}`
  if (seen.has(key)) return
  seen.add(key)
  foods.push(f)
}

// --------------------------------------------------------------------------
// 1. TACO — 597 alimentos de laboratório, bem agrupados, sem medida caseira
// --------------------------------------------------------------------------
{
  const rows = parseCsv(readFileSync(join(SCRATCH, 'csvs/taco_composicao.csv'), 'utf8'))
  const header = rows[0]!
  const col = (name: string) => header.indexOf(name)
  const iNum = col('numero_alimento')
  const iDesc = col('descricao')
  const iEner = col('energia_kcal')
  const iProt = col('proteina_g')
  const iLip = col('lipideos_g')
  const iCarb = col('carboidrato_g')
  const iFib = col('fibra_g')
  const iCat = col('categoria')
  for (const r of rows.slice(1)) {
    const code = r[iNum]?.trim()
    const desc = r[iDesc]?.trim()
    if (!code || !desc) continue
    const p = clamp(n(r[iProt]), 0, 100) ?? 0
    const c = clamp(n(r[iCarb]), 0, 100) ?? 0
    const f = clamp(n(r[iLip]), 0, 100) ?? 0
    const energy = clamp(n(r[iEner]) ?? atwater(p, c, f), 0, 1000) ?? 0
    pushFood({
      source: 'taco',
      external_code: code,
      name: titleize(desc),
      group_slug: TACO_GROUP[r[iCat]?.trim() ?? ''] ?? 'outros',
      reference_grams: 100,
      energy_kcal: round2(energy),
      protein_g: round2(p),
      carb_g: round2(c),
      fat_g: round2(f),
      fiber_g: clamp(n(r[iFib]), 0, 100) === null ? null : round2(clamp(n(r[iFib]), 0, 100)!),
    })
  }
}

// --------------------------------------------------------------------------
// 2. POF composição — alimento×preparo; tem medida caseira na tabela irmã
// --------------------------------------------------------------------------
{
  const rows = parseCsv(readFileSync(join(SCRATCH, 'pof/pof_composicao.csv'), 'utf8'))
  const header = rows[0]!.map((h) => h.replace(/\s+/g, ' ').trim())
  const col = (frag: string) => header.findIndex((h) => h.includes(frag))
  const iAli = col('CÓDIGO DO ALIMENTO')
  const iAliDesc = col('DESCRIÇÃO DO ALIMENTO')
  const iPrep = col('CÓDIGO DA PREPARAÇÃO')
  const iPrepDesc = col('DESCRIÇÃO DA PREPARAÇÃO')
  const iEner = col('ENERGIA (kcal)')
  const iProt = col('PROTEÍNA')
  const iLip = col('LIPÍDEOS TOTAIS')
  const iCarb = col('CARBOIDRATO')
  const iFib = col('FIBRA ALIMENTAR TOTAL')
  for (const r of rows.slice(1)) {
    const ali = r[iAli]?.trim()
    const prep = r[iPrep]?.trim()
    const desc = r[iAliDesc]?.trim()
    if (!ali || !desc) continue
    const extCode = `${ali}_${prep ?? '0'}`
    const prepDesc = r[iPrepDesc]?.trim()
    const showPrep = prepDesc && !/NAO SE APLICA/i.test(prepDesc) ? ` (${prepDesc.toLowerCase()})` : ''
    const p = clamp(n(r[iProt]), 0, 100) ?? 0
    const c = clamp(n(r[iCarb]), 0, 100) ?? 0
    const f = clamp(n(r[iLip]), 0, 100) ?? 0
    const energy = clamp(n(r[iEner]) ?? atwater(p, c, f), 0, 1000) ?? 0
    pushFood({
      source: 'ibge_pof',
      external_code: extCode,
      name: `${titleize(desc)}${showPrep}`,
      group_slug: 'outros', // POF não traz grupo; refinar depois (US3 usa listas curadas)
      reference_grams: 100,
      energy_kcal: round2(energy),
      protein_g: round2(p),
      carb_g: round2(c),
      fat_g: round2(f),
      fiber_g: clamp(n(r[iFib]), 0, 100) === null ? null : round2(clamp(n(r[iFib]), 0, 100)!),
    })
  }
}

// --------------------------------------------------------------------------
// 3. POF medidas caseiras — join por (alimento, preparação) = external_code
// --------------------------------------------------------------------------
{
  const rows = parseCsv(readFileSync(join(SCRATCH, 'pof/pof_medidas.csv'), 'utf8'))
  const header = rows[0]!.map((h) => h.replace(/\s+/g, ' ').trim())
  const col = (frag: string) => header.findIndex((h) => h.includes(frag))
  const iAli = col('CÓDIGO DO ALIMENTO')
  const iPrep = col('CÓDIGO DA PREPARAÇÃO')
  const iMedDesc = col('DESCRIÇÃO DO TIPO DE MEDIDA')
  const iPadraoCod = col('CÓDIGO DO TIPO DE MEDIDA PADRÃO')
  const iMedCod = col('CÓDIGO DO TIPO DE MEDIDA')
  const iGramas = header.findIndex((h) => h.includes('QUANTIDADE') && h.includes('GRAMAS'))
  const known = new Set(foods.filter((f) => f.source === 'ibge_pof').map((f) => f.external_code))
  const perFood = new Map<string, Set<string>>() // dedup label por alimento
  for (const r of rows.slice(1)) {
    const ali = r[iAli]?.trim()
    const prep = r[iPrep]?.trim()
    if (!ali) continue
    const extCode = `${ali}_${prep ?? '0'}`
    if (!known.has(extCode)) continue
    const label = titleize(r[iMedDesc]?.trim() ?? '')
    const grams = n(r[iGramas])
    if (!label || grams === null || grams <= 0) continue
    const labels = perFood.get(extCode) ?? new Set<string>()
    if (labels.has(label)) continue
    labels.add(label)
    perFood.set(extCode, labels)
    measures.push({
      source: 'ibge_pof',
      food_external_code: extCode,
      label,
      grams: round2(grams),
      is_default: r[iMedCod]?.trim() === r[iPadraoCod]?.trim(),
    })
  }
}

// --------------------------------------------------------------------------
// 4. Emitir o bloco SQL (staging + COPY + INSERT resolvendo grupo/medida)
// --------------------------------------------------------------------------
// O applier de migrations do Supabase usa o protocolo estendido (Parse/Bind/
// Execute) e NÃO suporta `COPY ... FROM stdin` inline. Emitimos INSERT em lote.
function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
function qn(v: number | null): string {
  return v === null ? 'NULL' : String(v)
}

/** Gera `INSERT INTO tbl (cols) VALUES (...),(...);` em lotes. */
function batchInsert(table: string, cols: string, rows: string[], size = 500): string {
  const out: string[] = []
  for (let i = 0; i < rows.length; i += size) {
    out.push(`INSERT INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + size).join(',\n')};`)
  }
  return out.join('\n')
}

const foodValues = foods.map(
  (f) =>
    `(${q(f.source)},${q(f.external_code)},${q(f.name)},${q(f.group_slug)},${f.reference_grams},${f.energy_kcal},${f.protein_g},${f.carb_g},${f.fat_g},${qn(f.fiber_g)})`,
)
const measureValues = measures.map(
  (m) =>
    `(${q(m.source)},${q(m.food_external_code)},${q(m.label)},${m.grams},${m.is_default ? 'true' : 'false'})`,
)

const sql = `-- Seed do catálogo global de alimentos (gerado por scripts/build-foods-seed.ts).
-- ${foods.length} alimentos (${foods.filter((f) => f.source === 'taco').length} TACO + ${foods.filter((f) => f.source === 'ibge_pof').length} IBGE/POF) + ${measures.length} medidas caseiras.
-- Atribuição das fontes é obrigação de licença (TACO) — exibida na UI (FR-020).

-- Staging temporário. Sem ON COMMIT DROP: em psql autocommit isso derrubaria a
-- tabela antes do INSERT (cada statement é uma transação). Temp table vive até
-- o fim da sessão; dropamos explicitamente no final.
DROP TABLE IF EXISTS _seed_foods;
CREATE TEMP TABLE _seed_foods (
  source text, external_code text, name text, group_slug text,
  reference_grams numeric, energy_kcal numeric, protein_g numeric,
  carb_g numeric, fat_g numeric, fiber_g numeric
);
${batchInsert('_seed_foods', 'source, external_code, name, group_slug, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g', foodValues)}

INSERT INTO public.foods
  (tenant_id, source, external_code, name, group_id, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g)
SELECT NULL, s.source, s.external_code, s.name, g.id, s.reference_grams,
       s.energy_kcal, s.protein_g, s.carb_g, s.fat_g, s.fiber_g
FROM _seed_foods s
LEFT JOIN public.food_groups g ON g.slug = s.group_slug
ON CONFLICT (source, external_code) WHERE tenant_id IS NULL AND external_code IS NOT NULL DO NOTHING;

DROP TABLE IF EXISTS _seed_measures;
CREATE TEMP TABLE _seed_measures (
  source text, food_external_code text, label text, grams numeric, is_default boolean
);
${batchInsert('_seed_measures', 'source, food_external_code, label, grams, is_default', measureValues)}

INSERT INTO public.food_household_measures (food_id, tenant_id, label, grams, is_default)
SELECT f.id, NULL, m.label, m.grams, m.is_default
FROM _seed_measures m
JOIN public.foods f
  ON f.tenant_id IS NULL AND f.source = m.source AND f.external_code = m.food_external_code;

DROP TABLE IF EXISTS _seed_foods;
DROP TABLE IF EXISTS _seed_measures;
`

const migration = readFileSync(MIGRATION, 'utf8')
if (!migration.includes(MARKER)) {
  throw new Error(`marcador ${MARKER} não encontrado na migration`)
}
writeFileSync(MIGRATION, migration.replace(MARKER, sql), 'utf8')

console.log(
  `[build-foods-seed] ${foods.length} alimentos + ${measures.length} medidas injetados na 0176.`,
)

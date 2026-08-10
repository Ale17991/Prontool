/**
 * Leitura do catálogo TUSS a partir da fonte OFICIAL da ANS.
 *
 *   https://www.ans.gov.br/arquivos/extras/tiss/
 *     Padrao_TISS_Representacao_de_Conceitos_em_Saude_<versao>.zip
 *
 * Compartilhado por `seed-tuss.ts` (importa para `tuss_codes`) e
 * `check-tuss-collision.ts` (verifica a precondição de UNIQUE(code) global).
 * Os dois precisam ler exatamente as mesmas linhas — se a checagem de colisão
 * usasse um parser próprio, ela poderia aprovar um pacote que o seed lê
 * diferente, que é justo o caso em que a verificação teria de falhar.
 *
 * POR QUE NÃO É MAIS O ESPELHO DO GITHUB
 * --------------------------------------
 * Até a migration 0194 a fonte era `charlesfgarcia/tabelas-ans`, um espelho
 * comunitário em JSON. Ele parou de acompanhar a ANS: entregava 5.851
 * procedimentos contra 5.967 do oficial e 1.114 medicamentos contra 44.574.
 * Código publicado depois do último commit do espelho simplesmente não existia
 * no sistema — `30310172` e `20101406` (ambos de oftalmologia) foram os que
 * apareceram no uso real. O espelho também não trazia a coluna de FIM DE
 * VIGÊNCIA, então `valid_to` era sempre NULL e o trigger de código aposentado
 * nunca disparava. Ver docs/data-sources.md.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'
import ExcelJS from 'exceljs'

/**
 * Versão do pacote ANS. A ANS publica a cada dois meses e mantém as anteriores
 * no ar; fixar aqui (em vez de descobrir "a mais nova") faz o import ser
 * reprodutível e deixa a atualização visível em PR.
 */
export const ANS_VERSION_DEFAULT = '202607'
const ANS_BASE_URL = 'https://www.ans.gov.br/arquivos/extras/tiss'
/** gov.br derruba cliente sem User-Agent de browser (mesma nota do seed-tuss-38). */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CACHE_DIR = join(process.cwd(), '.cache', 'tuss')

export type TussTable = '18' | '19' | '20' | '22'
export const SUPPORTED_TABLES: TussTable[] = ['22', '19', '20', '18']

export interface TussSourceRow {
  code: string
  description: string
  manufacturer: string | null
  valid_from: string
  valid_to: string | null
}

/**
 * Como achar a planilha de cada tabela dentro do zip e o que significa cada
 * coluna. O casamento é por REGEX no nome da entrada e por RÓTULO no cabeçalho
 * — nunca por índice fixo: a ANS troca a posição das colunas entre versões
 * (a 19 ganhou "Classe de Risco" e "Nome Técnico" no caminho) e renomeia os
 * arquivos com a versão embutida.
 */
interface TableSpec {
  /** Entradas .xlsx do zip que compõem a tabela (a 19 vem partida em duas). */
  entry: RegExp
  /** Rótulos das colunas que, concatenadas, viram `description`. */
  descriptionColumns: string[]
  /** Rótulo da coluna que vira `manufacturer` (ausente em 18 e 22). */
  manufacturerColumn?: string
}

const SPECS: Record<TussTable, TableSpec> = {
  '22': {
    entry: /^tuss 22\b.*\.xlsx$/i,
    descriptionColumns: ['termo'],
  },
  '19': {
    entry: /^tuss 19\b.*\.xlsx$/i,
    descriptionColumns: ['termo'],
    manufacturerColumn: 'fabricante',
  },
  '20': {
    // "REOPRO" e "2 MG/ML SOL INJ" são colunas separadas na planilha, mas o
    // usuário procura pelo nome comercial COM a apresentação — é assim que o
    // item aparece na nota. Concatenar aqui mantém a descrição no mesmo formato
    // que o catálogo antigo entregava.
    entry: /^tuss 20\b.*\.xlsx$/i,
    descriptionColumns: ['termo', 'apresentacao'],
    manufacturerColumn: 'laboratorio',
  },
  '18': {
    entry: /^tuss 18\b.*\.xlsx$/i,
    descriptionColumns: ['termo'],
  },
}

const COL_CODE = 'codigo do termo'
const COL_VALID_FROM = 'data de inicio de vigencia'
const COL_VALID_TO = 'data de fim de vigencia'

/**
 * Fallback de início de vigência para linha sem data. "2008-01-01" é o marcador
 * histórico usado desde o primeiro seed (início da padronização TUSS).
 */
const VALID_FROM_FALLBACK = '2008-01-01'

// ---------------- download + extração --------------------------------------

/** Baixa o zip da ANS para `.cache/tuss/`, ou reusa o que já está lá. */
export async function ensureAnsZip(version: string, log = console.info): Promise<string> {
  const override = process.env.TUSS_ANS_ZIP
  if (override) {
    if (!existsSync(override)) throw new Error(`TUSS_ANS_ZIP não existe: ${override}`)
    return override
  }

  mkdirSync(CACHE_DIR, { recursive: true })
  const name = `Padrao_TISS_Representacao_de_Conceitos_em_Saude_${version}.zip`
  const dest = join(CACHE_DIR, name)
  if (existsSync(dest) && statSync(dest).size > 0) {
    log(`[tuss] zip em cache: ${dest} (${mb(statSync(dest).size)})`)
    return dest
  }

  const url = `${ANS_BASE_URL}/${name}`
  log(`[tuss] baixando ${url} — são ~400 MB, pode demorar`)
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } })
  if (!res.ok || !res.body) {
    throw new Error(
      `[tuss] download falhou: HTTP ${res.status}. Confira se a versão ${version} ainda ` +
        'está publicada em https://www.gov.br/ans/pt-br/assuntos/prestadores/' +
        'padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss',
    )
  }
  // Grava em .part e só renomeia no fim: download interrompido não pode virar
  // cache "válido" e envenenar as próximas rodadas.
  const part = `${dest}.part`
  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(part),
    )
  } catch (err) {
    await unlink(part).catch(() => undefined)
    throw err
  }
  await rename(part, dest)
  log(`[tuss] baixado: ${mb(statSync(dest).size)}`)
  return dest
}

/** Extrai (uma vez) as planilhas de uma tabela e devolve os caminhos. */
export async function ensureSheets(
  zipPath: string,
  table: TussTable,
  log = console.info,
): Promise<string[]> {
  const spec = SPECS[table]
  // O diretório de planilhas é derivado do NOME DO ZIP, não fixo: o regex de
  // entrada casa qualquer versão ("TUSS 22 ... VERSÃO 202607.xlsx" e a de
  // 202609 batem no mesmo `^tuss 22\b`), então uma pasta única faria um
  // `--version` novo reusar as planilhas velhas sem avisar — o seed diria que
  // importou a versão nova e teria importado a antiga.
  const outDir = join(CACHE_DIR, 'sheets', basename(zipPath).replace(/\.zip$/i, ''))
  mkdirSync(outDir, { recursive: true })

  const cached = (await readdir(outDir)).filter((f) => spec.entry.test(f))
  if (cached.length > 0) return cached.map((f) => join(outDir, f))

  const zip = new AdmZip(zipPath)
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    // `~$...xlsx` são lock files do Excel que a ANS empacotou por engano.
    .filter((e) => !basename(e.entryName).startsWith('~$'))
    .filter((e) => spec.entry.test(basename(e.entryName)))

  if (entries.length === 0) {
    throw new Error(
      `[tuss] nenhuma planilha da tabela ${table} em ${zipPath} — a ANS pode ter ` +
        'renomeado o arquivo nesta versão; ajuste SPECS.entry em scripts/tuss-ans-source.ts.',
    )
  }

  const paths: string[] = []
  for (const e of entries) {
    const name = basename(e.entryName)
    log(`[tuss] extraindo ${name} (${mb(e.header.size)})`)
    zip.extractEntryTo(e, outDir, /* maintainEntryPath */ false, /* overwrite */ true)
    paths.push(join(outDir, name))
  }
  return paths
}

// ---------------- leitura da planilha --------------------------------------

/**
 * Lê todas as planilhas de uma tabela e devolve as linhas normalizadas,
 * ordenadas por código e sem duplicata.
 */
export async function readTable(
  zipPath: string,
  table: TussTable,
  log = console.info,
): Promise<TussSourceRow[]> {
  const files = await ensureSheets(zipPath, table, log)
  const rows: TussSourceRow[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const before = rows.length
    await readSheet(file, SPECS[table], seen, rows)
    log(`[tuss]   ${basename(file)}: +${rows.length - before} códigos`)
  }
  if (rows.length === 0) throw new Error(`[tuss] tabela ${table} veio vazia`)
  rows.sort((a, b) => a.code.localeCompare(b.code))
  return rows
}

/**
 * Lê uma planilha em streaming e acrescenta as linhas normalizadas em `out`.
 *
 * Streaming não é preciosismo: a parte 1 da Tabela 19 tem 817 mil linhas e
 * 76 MB — carregar a workbook inteira em memória derruba o processo.
 */
async function readSheet(
  path: string,
  spec: TableSpec,
  seen: Set<string>,
  out: TussSourceRow[],
): Promise<void> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    entries: 'ignore',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  })

  /** Mapa rótulo-normalizado → índice 1-based, montado ao achar o cabeçalho. */
  let header: Map<string, number> | null = null
  const at = (row: ExcelJS.Row, label: string): string => {
    const idx = header?.get(label)
    return idx ? cellText(row.getCell(idx).value).trim() : ''
  }

  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      if (header === null) {
        // A linha de cabeçalho não fica numa posição fixa: a 22 usa a linha 8,
        // a 19 a 9 e a 20 a 10, e isso muda entre versões. E a primeira aba de
        // toda planilha da ANS é uma CAPA sem dado nenhum. Procurar pelo rótulo
        // é o único casamento estável.
        if (normalizeLabel(cellText(row.getCell(1).value)) === COL_CODE) header = readHeader(row)
        continue
      }

      const code = at(row, COL_CODE)
      if (!/^\d+$/.test(code)) continue

      const description = spec.descriptionColumns
        .map((c) => at(row, c))
        .filter((s) => s.length > 0)
        .join(' ')
      if (!description) continue

      // A ANS zera à esquerda os códigos de 8 dígitos, mas o Excel guarda como
      // número e come o zero. A 19 tem ainda uma faixa nova de 9 dígitos
      // (1000000xx) — por isso o pad é condicional, e não um truncamento.
      const padded = code.length < 8 ? code.padStart(8, '0') : code
      if (seen.has(padded)) continue
      seen.add(padded)

      out.push({
        code: padded,
        description,
        manufacturer: spec.manufacturerColumn ? at(row, spec.manufacturerColumn) || null : null,
        valid_from: parseDate(at(row, COL_VALID_FROM)) ?? VALID_FROM_FALLBACK,
        valid_to: parseDate(at(row, COL_VALID_TO)),
      })
    }
  }

  if (header === null) {
    throw new Error(`[tuss] cabeçalho "${COL_CODE}" não encontrado em ${basename(path)}`)
  }
}

function readHeader(row: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>()
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = normalizeLabel(cellText(cell.value))
    if (label && !map.has(label)) map.set(label, colNumber)
  })
  return map
}

/** "Data de início de vigência" → "data de inicio de vigencia". */
function normalizeLabel(raw: string): string {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  const o = value as { richText?: Array<{ text: string }>; text?: string; result?: unknown }
  if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('')
  if (typeof o.text === 'string') return o.text
  if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue)
  return ''
}

/**
 * Data da planilha → "AAAA-MM-DD", sempre em UTC.
 *
 * Duas formas chegam aqui e as duas são reais:
 *
 *  - **Serial do Excel** (`39857`). É o caso normal desta importação: o leitor
 *    em streaming roda com `styles: 'ignore'`, e sem a tabela de estilos o
 *    exceljs não tem como saber que aquela coluna é data — devolve o número
 *    cru. Ler o estilo de 1,5 milhão de linhas só pra descobrir isso custaria
 *    caro; converter o serial é aritmética. Sem esta conversão a vigência de
 *    "2009-02-13" era gravada como "39857-01-01" e TODA data ficava errada.
 *  - **String ISO**, quando o exceljs já reconheceu a célula como data.
 *
 * Ler e escrever em UTC fecha o ciclo. Usar os getters locais jogaria a
 * vigência para o dia anterior em qualquer máquina a oeste de Greenwich —
 * exatamente o erro que `brDateTz` corrigiu nos impressos (054).
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

function parseDate(raw: string): string | null {
  if (!raw) return null

  let d: Date
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw)
    // Abaixo de 1 não é data (0 = a própria época, e a ANS não tem vigência
    // anterior a 1900); acima de ~2200 é lixo.
    if (serial < 1 || serial > 110000) return null
    d = new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86_400_000)
  } else {
    d = new Date(raw)
  }
  if (Number.isNaN(d.getTime())) return null

  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------- utilidades -----------------------------------------------

export function parseVersionArg(args: string[], fallback = ANS_VERSION_DEFAULT): string {
  const i = args.indexOf('--version')
  if (i < 0) return process.env.TUSS_ANS_VERSION ?? fallback
  const v = args[i + 1]
  if (!v || !/^\d{6}$/.test(v)) throw new Error(`--version inválida: ${v} (esperado AAAAMM)`)
  return v
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Feature 029 (T006) — seed das tabelas de domínio TISS em `tiss_domain_tables`.
 *
 * FONTE OFICIAL (sem transcrição manual): os domínios enumeráveis são extraídos
 * dos tipos `dm_*` do XSD oficial `tissSimpleTypesV4_03_00.xsd` (já versionado em
 * src/lib/core/tiss/schemas/04.03.00/). Os CÓDIGOS vêm dos `<enumeration>` (fonte
 * autoritativa que o próprio validador XSD aplica); as DESCRIÇÕES são best-effort
 * a partir dos comentários do XSD (formatos variam — quando ausente, fica vazia).
 *
 * Cobertura: domínios 23, 24, 26, 35, 36, 48, 50, 52, 59, 76, 87.
 * FORA daqui: Tabela 38 (Glosas) — não é enumerada no XSD; será semeada na US5
 * a partir da CodeSystem oficial da ANS (fhir-hm.ans.gov.br/CodeSystem-tuss-38).
 *
 * Idempotente: INSERT ... ON CONFLICT DO NOTHING (a tabela é append-only).
 *
 * Uso: `pnpm seed:tiss-domains`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

/** Mapeamento tipo XSD `dm_*` → número do domínio TISS (legenda oficial 202511). */
const DM_TO_DOMAIN: Record<string, string> = {
  dm_caraterAtendimento: '23',
  dm_CBOS: '24',
  dm_conselhoProfissional: '26',
  dm_grauPart: '35',
  dm_indicadorAcidente: '36',
  dm_tecnicaUtilizada: '48',
  dm_tipoAtendimento: '50',
  dm_tipoConsulta: '52',
  dm_UF: '59',
  dm_regimeAtendimento: '76',
  dm_tabela: '87',
}

const VALID_FROM = '2000-01-01'

interface DomainRow {
  domain_number: string
  code: string
  description: string
}

function extractBlock(xsd: string, dmName: string): string | null {
  const re = new RegExp(`<simpleType name="${dmName}">[\\s\\S]*?</simpleType>`)
  const m = re.exec(xsd)
  return m ? m[0] : null
}

/**
 * Constrói um mapa code→description a partir dos comentários do bloco. Os
 * comentários do XSD têm formatos variados: por-linha (`1 - Primeira`),
 * tab-separados (`11\tRondônia\tRO`), ou sem traço (`18 TUSS _ Taxas`). Aqui
 * normalizamos: para cada linha de comentário, o 1º token é o código e o resto
 * (tabs→espaço, colapsado) é a descrição. Indexamos por código cru E sem zero à
 * esquerda, para casar com enumerações que usam zero-padding distinto.
 */
function parseDescriptions(block: string): Map<string, string> {
  const map = new Map<string, string>()
  const comments = block.match(/<!--[\s\S]*?-->/g) ?? []
  for (const c of comments) {
    const inner = c.replace(/^<!--/, '').replace(/-->$/, '')
    for (const rawLine of inner.split(/\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('*')) continue
      const m = /^([0-9A-Za-z]+)[\s\-.\t]+(.+)$/.exec(line)
      if (!m) continue
      const code = m[1]
      const rawDesc = m[2]
      if (code === undefined || rawDesc === undefined) continue
      const desc = rawDesc
        .replace(/[\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
      if (!desc) continue
      for (const key of [code, code.replace(/^0+(?=\d)/, '')]) {
        if (!map.has(key)) map.set(key, desc)
      }
    }
  }
  return map
}

function buildRows(xsd: string): DomainRow[] {
  const rows: DomainRow[] = []
  for (const [dmName, domainNumber] of Object.entries(DM_TO_DOMAIN)) {
    const block = extractBlock(xsd, dmName)
    if (!block) {
      throw new Error(`[seed-tiss-domains] tipo ${dmName} não encontrado no XSD`)
    }
    const codes = [...block.matchAll(/enumeration value="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((c): c is string => typeof c === 'string')
    if (codes.length === 0) {
      throw new Error(`[seed-tiss-domains] ${dmName} sem enumerações`)
    }
    const descByCode = parseDescriptions(block)
    for (const code of codes) {
      const description =
        descByCode.get(code) ?? descByCode.get(code.replace(/^0+(?=\d)/, '')) ?? code
      rows.push({ domain_number: domainNumber, code, description })
    }
  }
  return rows
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios')
  }

  const xsdPath = join(
    process.cwd(),
    'src',
    'lib',
    'core',
    'tiss',
    'schemas',
    '04.03.00',
    'tissSimpleTypesV4_03_00.xsd',
  )
  const xsd = readFileSync(xsdPath, 'latin1')
  const rows = buildRows(xsd)

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const payload = rows.map((r) => ({ ...r, valid_from: VALID_FROM }))
  const { error } = await supabase
    .from('tiss_domain_tables')
    .upsert(payload, { onConflict: 'domain_number,code,valid_from', ignoreDuplicates: true })
  if (error) throw new Error(`[seed-tiss-domains] upsert falhou: ${error.message}`)

  // Resumo por domínio.
  const byDomain = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.domain_number] = (acc[r.domain_number] ?? 0) + 1
    return acc
  }, {})
  // eslint-disable-next-line no-console
  console.log(
    `[seed-tiss-domains] concluído — ${rows.length} entradas em ${Object.keys(byDomain).length} domínios:`,
    byDomain,
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})

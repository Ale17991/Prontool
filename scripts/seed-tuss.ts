#!/usr/bin/env tsx
/**
 * Importa o catálogo TUSS (tabelas 22 — procedimentos, 19 — materiais/OPME,
 * 20 — medicamentos) para `tuss_codes`.
 *
 * O conteúdo das tabelas TUSS é dado público da ANS (Agência Nacional de
 * Saúde Suplementar). O repositório `charlesfgarcia/tabelas-ans` é um
 * mirror conveniente em JSON. Se o mirror desaparecer, basta apontar
 * `TUSS_SOURCE_URL` para outro JSON com o mesmo shape ou usar `--url`.
 *
 * Shapes suportados:
 *   Tabela 22:   { table, rows: [{ codigo, procedimento }] }
 *   Tabela 19/20:{ table, rows: [{ codigo, descricao, fabricante, tabela }] }
 *
 * Uso:
 *   pnpm seed:tuss:22                       # procedimentos (default)
 *   pnpm seed:tuss:19                       # materiais/OPME (~38 k códigos)
 *   pnpm seed:tuss:20                       # medicamentos
 *   pnpm seed:tuss:all                      # os três em sequência
 *   tsx scripts/seed-tuss.ts --table 19     # forma direta
 *   SEED_TUSS_FORCE=1 pnpm seed:tuss:22     # ignora licença ausente
 */
import { createHash } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detectDeprecatedTussCodes } from '@/lib/core/catalog/detect-deprecated'

const REPO = 'charlesfgarcia/tabelas-ans'
const REPO_REF = process.env.TUSS_REPO_REF ?? 'master'

type TussTable = '22' | '19' | '20'
const SUPPORTED_TABLES: TussTable[] = ['22', '19', '20']

const SOURCE_PATH: Record<TussTable, string> = {
  '22': 'TUSS/tabela%2022/tabela_22.json',
  '19': 'TUSS/tabela%2019/tabela_19.json',
  '20': 'TUSS/tabela%2020/tabela_20.json',
}

interface SourceRow {
  codigo: number | string
  procedimento?: string
  descricao?: string
  fabricante?: string
}
interface SourcePayload {
  table?: string
  rows: SourceRow[]
}

interface NormalizedRow {
  code: string
  description: string
  manufacturer: string | null
  valid_from: string
}

function parseArgs(): { tables: TussTable[]; urlOverride: string | null } {
  const args = process.argv.slice(2)
  let tables: TussTable[] = ['22']
  let urlOverride: string | null = process.env.TUSS_SOURCE_URL ?? null
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--table') {
      const v = args[++i]
      if (v === 'all') {
        tables = [...SUPPORTED_TABLES]
      } else if (SUPPORTED_TABLES.includes(v as TussTable)) {
        tables = [v as TussTable]
      } else {
        throw new Error(`--table inválido: ${v} (aceitos: ${SUPPORTED_TABLES.join(', ')} ou 'all')`)
      }
    } else if (a === '--url') {
      urlOverride = args[++i] ?? null
    }
  }
  return { tables, urlOverride }
}

async function main(): Promise<void> {
  const { tables, urlOverride } = parseArgs()

  // --- Licença (uma vez, compartilhada entre tabelas do mesmo repo) -----
  const licenseInfo = await fetchLicenseInfo(REPO)
  if (!licenseInfo.accepted) {
    if (process.env.SEED_TUSS_FORCE !== '1') {
      console.error(`[seed-tuss] ABORTADO: ${REPO} declara licença "${licenseInfo.name ?? 'NENHUMA'}".`)
      console.error('[seed-tuss] O conteúdo é dado público da ANS, mas o mirror não declarou licença.')
      console.error('[seed-tuss] Para prosseguir em DEV/staging, rode com SEED_TUSS_FORCE=1 e documente em docs/data-sources.md antes de produção.')
      process.exit(2)
    }
    console.warn('[seed-tuss] SEED_TUSS_FORCE=1: prosseguindo sem licença declarada.')
  } else {
    console.info(`[seed-tuss] licença aceita: ${licenseInfo.name} (${licenseInfo.spdx ?? 'sem SPDX'})`)
  }

  const supabase = createSupabaseServiceClient()
  const refSha = await resolveCommitSha(REPO, REPO_REF)

  for (const table of tables) {
    const url = urlOverride ?? `https://raw.githubusercontent.com/${REPO}/${REPO_REF}/${SOURCE_PATH[table]}`
    console.info(`[seed-tuss] === tabela ${table} — ${url}`)

    const res = await fetch(url)
    if (!res.ok) throw new Error(`failed to download ${url}: HTTP ${res.status}`)
    const raw = await res.text()
    console.info(`[seed-tuss] baixou ${(raw.length / 1024).toFixed(1)} KB; commit ${refSha.slice(0, 8)}`)

    const payload = JSON.parse(raw) as SourcePayload
    if (!Array.isArray(payload.rows)) throw new Error(`payload da tabela ${table} sem \`rows\` array`)
    const normalized = normalize(table, payload.rows)
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    console.info(`[seed-tuss] parseou ${normalized.length} códigos (content-hash ${hash.slice(0, 12)})`)

    const versionInsert = await supabase
      .from('tuss_catalog_versions')
      .insert({
        source_ref: `tabela_${table}@${refSha}`,
        content_hash: hash,
        code_count: normalized.length,
        notes: `seed-tuss.ts table=${table} ref=${REPO_REF} url=${url} license=${licenseInfo.name ?? 'override'}`,
      })
      .select('id')
      .single()
    if (versionInsert.error || !versionInsert.data) {
      throw new Error(`tuss_catalog_versions insert failed: ${versionInsert.error?.message}`)
    }
    const versionId = versionInsert.data.id

    const BATCH = 1000
    for (let i = 0; i < normalized.length; i += BATCH) {
      const slice = normalized.slice(i, i + BATCH).map((r) => ({
        code: r.code,
        description: r.description,
        manufacturer: r.manufacturer,
        tuss_table: table,
        valid_from: r.valid_from,
        valid_to: null,
        source_catalog_version_id: versionId,
      }))
      const { error } = await supabase.from('tuss_codes').upsert(slice, { onConflict: 'code' })
      if (error) throw new Error(`tuss_codes upsert tabela=${table} offset=${i}: ${error.message}`)
      console.info(`[seed-tuss] tabela ${table}: upsert ${Math.min(i + BATCH, normalized.length)}/${normalized.length}`)
    }
  }

  // Rodar o scan de deprecation depois de todas as tabelas: um código
  // deprecated em qualquer tabela afeta qualquer procedure que aponta
  // pra ele, independente da tabela de origem.
  const scan = await detectDeprecatedTussCodes()
  console.info(`[seed-tuss] scan deprecation: scanned=${scan.scanned} alerts=${scan.alerts}`)

  console.info('[seed-tuss] concluído.')
}

// ---------------- helpers --------------------------------------------------

async function fetchLicenseInfo(repo: string): Promise<{
  accepted: boolean
  name?: string | null
  spdx?: string | null
}> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/license`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return { accepted: false }
    const body = (await res.json()) as { license?: { name?: string; spdx_id?: string } }
    const spdx = body.license?.spdx_id ?? null
    const name = body.license?.name ?? null
    const permissive = new Set([
      'MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Unlicense', 'CC0-1.0',
    ])
    const accepted = !!spdx && permissive.has(spdx)
    return { accepted, name, spdx }
  } catch {
    return { accepted: false }
  }
}

async function resolveCommitSha(repo: string, ref: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`failed to resolve ref ${ref}: HTTP ${res.status}`)
  const body = (await res.json()) as { sha: string }
  return body.sha
}

// A tabela TUSS publicada não traz vigência; usamos "2008-01-01" (início
// da padronização TUSS) como marcador e deixamos valid_to NULL. Quando
// uma versão futura do catálogo retirar um código, o registro fica
// preservado e o detect-deprecated dispara.
const VALID_FROM = '2008-01-01'

function normalize(table: TussTable, rows: SourceRow[]): NormalizedRow[] {
  const seen = new Map<string, NormalizedRow>()
  for (const r of rows) {
    if (r.codigo === null || r.codigo === undefined) continue
    const code = String(r.codigo).trim().padStart(8, '0')
    if (!code) continue

    let description: string
    let manufacturer: string | null
    if (table === '22') {
      description = String(r.procedimento ?? '').trim()
      manufacturer = null
    } else {
      description = String(r.descricao ?? '').trim()
      manufacturer = r.fabricante ? String(r.fabricante).trim() || null : null
    }

    if (!description) continue
    seen.set(code, { code, description, manufacturer, valid_from: VALID_FROM })
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

main().catch((err: unknown) => {
  console.error('[seed-tuss] fatal:', err)
  process.exit(1)
})

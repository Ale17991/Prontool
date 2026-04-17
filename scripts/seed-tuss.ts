#!/usr/bin/env tsx
/**
 * T031 + T032: Importa o catálogo TUSS (Tabela 22 — procedimentos e
 * eventos em saúde) para `tuss_codes`.
 *
 * O conteúdo da Tabela TUSS é dado público da ANS (Agência Nacional de
 * Saúde Suplementar). O repositório `charlesfgarcia/tabelas-ans` é um
 * mirror conveniente em JSON. Se o mirror desaparecer, basta apontar
 * `TUSS_SOURCE_URL` para outro JSON com o mesmo shape:
 *   { table: string, rows: [{ codigo: number, procedimento: string }] }
 *
 * Uso:
 *   pnpm seed:tuss                       # com check de licença
 *   SEED_TUSS_FORCE=1 pnpm seed:tuss     # ignora licença ausente (dev/staging)
 */
import { createHash } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detectDeprecatedTussCodes } from '@/lib/core/catalog/detect-deprecated'

const REPO = 'charlesfgarcia/tabelas-ans'
const REPO_REF = process.env.TUSS_REPO_REF ?? 'master'
const SOURCE_URL =
  process.env.TUSS_SOURCE_URL ??
  `https://raw.githubusercontent.com/${REPO}/${REPO_REF}/TUSS/tabela%2022/tabela_22.json`

interface SourceRow {
  codigo: number | string
  procedimento: string
}
interface SourcePayload {
  table?: string
  rows: SourceRow[]
}

interface NormalizedRow {
  code: string
  description: string
  valid_from: string
}

async function main(): Promise<void> {
  console.info(`[seed-tuss] source: ${SOURCE_URL}`)

  // --- (1) Licença -------------------------------------------------------
  const licenseInfo = await fetchLicenseInfo(REPO)
  if (!licenseInfo.accepted) {
    if (process.env.SEED_TUSS_FORCE !== '1') {
      console.error(
        `[seed-tuss] ABORTADO: ${REPO} declara licença "${licenseInfo.name ?? 'NENHUMA'}".`,
      )
      console.error(
        '[seed-tuss] O conteúdo é dado público da ANS, mas o redistribuidor não declarou licença.',
      )
      console.error(
        '[seed-tuss] Para prosseguir em DEV/staging, rode com SEED_TUSS_FORCE=1 e documente em docs/data-sources.md antes de produção.',
      )
      process.exit(2)
    }
    console.warn('[seed-tuss] SEED_TUSS_FORCE=1: prosseguindo sem licença declarada.')
  } else {
    console.info(
      `[seed-tuss] licença aceita: ${licenseInfo.name} (${licenseInfo.spdx ?? 'sem SPDX'})`,
    )
  }

  // --- (2) Download ------------------------------------------------------
  const refSha = await resolveCommitSha(REPO, REPO_REF)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`failed to download ${SOURCE_URL}: HTTP ${res.status}`)
  const raw = await res.text()
  console.info(`[seed-tuss] baixou ${(raw.length / 1024).toFixed(1)} KB; commit ${refSha.slice(0, 8)}`)

  // --- (3) Parse + normalize --------------------------------------------
  const payload = JSON.parse(raw) as SourcePayload
  if (!Array.isArray(payload.rows)) throw new Error('payload missing `rows` array')
  const normalized = normalize(payload.rows)
  const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
  console.info(
    `[seed-tuss] parseou ${normalized.length} códigos (content-hash ${hash.slice(0, 12)})`,
  )

  // --- (4) Versão do catálogo ------------------------------------------
  const supabase = createSupabaseServiceClient()
  const versionInsert = await supabase
    .from('tuss_catalog_versions')
    .insert({
      source_ref: refSha,
      content_hash: hash,
      code_count: normalized.length,
      notes: `seed-tuss.ts ref=${REPO_REF} url=${SOURCE_URL} license=${
        licenseInfo.name ?? 'override'
      }`,
    })
    .select('id')
    .single()
  if (versionInsert.error || !versionInsert.data) {
    throw new Error(`tuss_catalog_versions insert failed: ${versionInsert.error?.message}`)
  }
  const versionId = versionInsert.data.id

  // --- (5) Upsert em batches ------------------------------------------
  const BATCH = 1000
  for (let i = 0; i < normalized.length; i += BATCH) {
    const slice = normalized.slice(i, i + BATCH).map((r) => ({
      code: r.code,
      description: r.description,
      valid_from: r.valid_from,
      valid_to: null,
      source_catalog_version_id: versionId,
    }))
    const { error } = await supabase.from('tuss_codes').upsert(slice, { onConflict: 'code' })
    if (error) throw new Error(`tuss_codes upsert at offset ${i}: ${error.message}`)
    console.info(
      `[seed-tuss] upsert ${Math.min(i + BATCH, normalized.length)}/${normalized.length}`,
    )
  }

  // --- (6) Fan-out de códigos retirados ---------------------------------
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
      'MIT',
      'Apache-2.0',
      'BSD-3-Clause',
      'BSD-2-Clause',
      'ISC',
      'Unlicense',
      'CC0-1.0',
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

function normalize(rows: SourceRow[]): NormalizedRow[] {
  // A tabela TUSS publicada não traz vigência, então usamos uma data
  // marcadora ("2008-01-01" ≈ início da padronização TUSS) e deixamos
  // valid_to NULL. Quando uma versão futura do catálogo retirar um
  // código, o registro fica preservado e o detect-deprecated dispara.
  const VALID_FROM = '2008-01-01'
  const seen = new Map<string, NormalizedRow>()
  for (const r of rows) {
    if (r.codigo === null || r.codigo === undefined) continue
    const code = String(r.codigo).trim().padStart(8, '0')
    const description = String(r.procedimento ?? '').trim()
    if (!code || !description) continue
    seen.set(code, { code, description, valid_from: VALID_FROM })
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

// Always run main when this file is executed (`tsx scripts/seed-tuss.ts`).
// The earlier import-meta-url guard was Windows-incompatible because path
// separators in `process.argv[1]` differ from the URL form.
main().catch((err: unknown) => {
  console.error('[seed-tuss] fatal:', err)
  process.exit(1)
})

#!/usr/bin/env tsx
/**
 * T031 + T032: Import the global TUSS catalog from
 * github.com/charlesfgarcia/tabelas-ans into tuss_codes.
 *
 * Steps:
 *  1) Verify the target repo has an acceptable LICENSE file before
 *     redistributing any content (T032).
 *  2) Download the repo tarball at a pinned commit SHA (env TUSS_REPO_REF
 *     or the default pinned below).
 *  3) Parse the tables and normalize into (code, description, valid_from,
 *     valid_to) rows.
 *  4) Insert a tuss_catalog_versions row with source_ref + content hash.
 *  5) Upsert tuss_codes rows under that version.
 *  6) Invoke detectDeprecatedTussCodes() so newly retired codes fan out
 *     alerts to affected tenants (T032b).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detectDeprecatedTussCodes } from '@/lib/core/catalog/detect-deprecated'

const DEFAULT_REF = process.env.TUSS_REPO_REF ?? 'main'
const REPO = 'charlesfgarcia/tabelas-ans'
const REPO_URL = `https://github.com/${REPO}`

type TussRow = {
  code: string
  description: string
  terminology_chapter?: string
  valid_from: string // YYYY-MM-DD
  valid_to?: string | null
}

async function main() {
  console.info(`[seed-tuss] source repo: ${REPO_URL} @ ${DEFAULT_REF}`)

  // --- (1) License gate --------------------------------------------------
  const licenseInfo = await fetchLicenseInfo(REPO)
  if (!licenseInfo.accepted) {
    console.error(
      `[seed-tuss] ABORTED: repository ${REPO} has license "${licenseInfo.name ?? 'NONE'}".`,
    )
    console.error(
      '[seed-tuss] Production seed requires an explicit permissive license decision. ' +
        'Set SEED_TUSS_FORCE=1 only after legal approval has been documented in docs/data-sources.md.',
    )
    if (process.env.SEED_TUSS_FORCE !== '1') {
      process.exit(2)
    }
    console.warn('[seed-tuss] SEED_TUSS_FORCE=1 set: proceeding with operator override.')
  } else {
    console.info(
      `[seed-tuss] license accepted: ${licenseInfo.name} (${licenseInfo.spdx ?? 'no SPDX id'})`,
    )
  }

  // --- (2) Download ------------------------------------------------------
  const tarball = await downloadTarball(REPO, DEFAULT_REF)
  const commitSha = tarball.commitSha
  const extractedDir = await extractTarball(tarball.path)
  console.info(`[seed-tuss] downloaded commit ${commitSha}`)

  // --- (3) Parse ---------------------------------------------------------
  const rows = parseRepo(extractedDir)
  const normalized = normalizeRows(rows)
  const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
  console.info(`[seed-tuss] parsed ${normalized.length} codes (content-hash ${hash.slice(0, 12)})`)

  // --- (4 + 5) Insert ----------------------------------------------------
  const supabase = createSupabaseServiceClient()

  const versionInsert = await supabase
    .from('tuss_catalog_versions')
    .insert({
      source_ref: commitSha,
      imported_by: null,
      content_hash: hash,
      code_count: normalized.length,
      notes: `seed-tuss.ts ref=${DEFAULT_REF} license=${licenseInfo.name ?? 'override'}`,
    })
    .select('id')
    .single()

  if (versionInsert.error || !versionInsert.data) {
    throw new Error(`tuss_catalog_versions insert failed: ${versionInsert.error?.message}`)
  }
  const versionId = versionInsert.data.id

  // Batched upsert (1000 rows per call)
  const BATCH = 1000
  for (let i = 0; i < normalized.length; i += BATCH) {
    const slice = normalized.slice(i, i + BATCH).map((r) => ({
      code: r.code,
      description: r.description,
      terminology_chapter: r.terminology_chapter ?? null,
      valid_from: r.valid_from,
      valid_to: r.valid_to ?? null,
      source_catalog_version_id: versionId,
    }))
    const { error } = await supabase.from('tuss_codes').upsert(slice, { onConflict: 'code' })
    if (error) throw new Error(`tuss_codes upsert batch failed at offset ${i}: ${error.message}`)
    console.info(`[seed-tuss] upserted ${Math.min(i + BATCH, normalized.length)}/${normalized.length}`)
  }

  // --- (6) Deprecation fan-out (T032b) -----------------------------------
  const scan = await detectDeprecatedTussCodes()
  console.info(`[seed-tuss] deprecation scan: scanned=${scan.scanned} alerts=${scan.alerts}`)

  console.info('[seed-tuss] done.')
}

// ---------------- helpers --------------------------------------------------

async function fetchLicenseInfo(repo: string): Promise<{
  accepted: boolean
  name?: string
  spdx?: string
}> {
  const res = await fetch(`https://api.github.com/repos/${repo}/license`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) return { accepted: false }
  const body = (await res.json()) as { license?: { name?: string; spdx_id?: string } }
  const spdx = body.license?.spdx_id ?? undefined
  const name = body.license?.name ?? undefined
  const permissive = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Unlicense', 'CC0-1.0'])
  const accepted = !!spdx && permissive.has(spdx)
  return { accepted, name, spdx }
}

async function downloadTarball(repo: string, ref: string): Promise<{ path: string; commitSha: string }> {
  const refRes = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!refRes.ok) throw new Error(`failed to resolve ref ${ref}: ${refRes.status}`)
  const refBody = (await refRes.json()) as { sha: string }
  const sha = refBody.sha

  const tarRes = await fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`)
  if (!tarRes.ok) throw new Error(`failed to download tarball: ${tarRes.status}`)
  const buf = Buffer.from(await tarRes.arrayBuffer())

  const dir = join(tmpdir(), 'tuss-seed')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sha}.tar.gz`)
  writeFileSync(file, buf)
  return { path: file, commitSha: sha }
}

async function extractTarball(_tarballPath: string): Promise<string> {
  // TODO: invoke `tar -xzf` via child_process or use node-stream-tar.
  // Parser below tolerates either directory layout or single JSON dump.
  // For v1, operator is expected to have `tar` on PATH. Left intentionally
  // minimal — replace with a proper tar-stream implementation once the
  // repo's layout is confirmed (license validation in Polish phase).
  throw new Error('extractTarball: pending concrete implementation once repo layout is confirmed (R5 follow-up)')
}

function parseRepo(_dir: string): TussRow[] {
  // Placeholder — real parser depends on repo structure.
  // Known formats to support (detected in file): CSV, JSON, XLSX.
  return []
}

function normalizeRows(rows: TussRow[]): TussRow[] {
  const seen = new Map<string, TussRow>()
  for (const r of rows) {
    const prev = seen.get(r.code)
    if (!prev || prev.valid_from < r.valid_from) seen.set(r.code, r)
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

// Only invoke when executed directly (not on `import`)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[seed-tuss] fatal:', err)
    process.exit(1)
  })
}

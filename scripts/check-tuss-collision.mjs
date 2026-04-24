#!/usr/bin/env node
/**
 * Verifica se códigos das tabelas TUSS 22, 19 e 20 colidem entre si.
 *
 * Precondição da Opção B do schema de múltiplas tabelas (migration 0037):
 * manter UNIQUE(code) global em tuss_codes. Se este script reportar colisão
 * em alguma atualização futura do mirror, a opção B quebra e precisaríamos
 * migrar para chave composta (tuss_table, code).
 *
 * Uso:
 *   node scripts/check-tuss-collision.mjs
 *
 * Saída é puro stdout; exit 0 = sem colisão, exit 1 = colisão detectada.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_REF = process.env.TUSS_REPO_REF ?? 'master'
const BASE = `https://raw.githubusercontent.com/charlesfgarcia/tabelas-ans/${REPO_REF}/TUSS`
const SOURCES = {
  '22': `${BASE}/tabela%2022/tabela_22.json`,
  '19': `${BASE}/tabela%2019/tabela_19.json`,
  '20': `${BASE}/tabela%2020/tabela_20.json`,
}

function normalize(x) {
  if (x === null || x === undefined) return null
  return String(x).trim().padStart(8, '0')
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  return buf.length
}

function extractCodes(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const codes = new Set()
  for (const r of raw.rows ?? []) {
    const c = normalize(r.codigo)
    if (c) codes.add(c)
  }
  return codes
}

function intersect(a, b) {
  const out = []
  for (const x of a) if (b.has(x)) out.push(x)
  return out
}

async function main() {
  const workdir = mkdtempSync(join(tmpdir(), 'tuss-collision-'))
  console.info(`[check] workdir: ${workdir}`)

  const sets = {}
  for (const [table, url] of Object.entries(SOURCES)) {
    const dest = join(workdir, `tabela_${table}.json`)
    const bytes = await download(url, dest)
    sets[table] = extractCodes(dest)
    console.info(`[check] tabela ${table}: ${(bytes / 1024).toFixed(0)} KB → ${sets[table].size} códigos`)
  }

  const pairs = [
    ['22', '19'],
    ['22', '20'],
    ['19', '20'],
  ]
  let collisions = 0
  for (const [a, b] of pairs) {
    const overlap = intersect(sets[a], sets[b])
    if (overlap.length > 0) {
      console.error(`[check] COLISÃO ${a}∩${b}: ${overlap.length} códigos. Amostra: ${overlap.slice(0, 5).join(', ')}`)
      collisions += overlap.length
    } else {
      console.info(`[check] ${a}∩${b}: 0 colisões`)
    }
  }

  if (collisions > 0) {
    console.error(`[check] FALHA: ${collisions} colisões detectadas. Migration 0037 (opção B, UNIQUE global) é inválida.`)
    process.exit(1)
  }
  console.info(`[check] OK: nenhum código colide entre as 3 tabelas.`)
}

main().catch((err) => {
  console.error('[check] fatal:', err)
  process.exit(2)
})

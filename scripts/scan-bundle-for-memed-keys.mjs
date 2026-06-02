#!/usr/bin/env node
/**
 * Conformidade Memed (Feature 027 / FR-013, parte 2) — varre o bundle gerado
 * (`.next/static/`) procurando segredos da Memed que tenham escapado para o
 * código JS entregue ao navegador. Roda DEPOIS de `pnpm build`.
 *
 * Patterns:
 *   - `mk_[A-Za-z0-9]{20,}`           (formato típico de chave Memed)
 *   - `MEMED[_-]?(API|SECRET)[_-]?KEY` (referência literal)
 *   - `process.env.MEMED`             (env de provider vazada no bundle)
 *
 * Saída mascara o match (primeiros/últimos chars). Exit 1 se ≥ 1 ocorrência.
 * Pula arquivos `.map` e > 50MB. `SCAN_PATH` env sobrescreve o diretório.
 *
 * Uso: pnpm build && pnpm scan:memed-keys
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCAN_PATH = process.env.SCAN_PATH || join(__dirname, '..', '.next', 'static')
const MAX_BYTES = 50 * 1024 * 1024

const PATTERNS = [
  { name: 'chave mk_...', re: /\bmk_[A-Za-z0-9]{20,}\b/g },
  { name: 'MEMED_(API|SECRET)_KEY', re: /MEMED[_-]?(API|SECRET)[_-]?KEY/gi },
  { name: 'process.env.MEMED', re: /process\.env\.MEMED/g },
]

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walk(full))
    } else if (!name.endsWith('.map') && st.size <= MAX_BYTES) {
      out.push(full)
    }
  }
  return out
}

function mask(s) {
  if (s.length <= 8) return '***'
  return `${s.slice(0, 4)}***${s.slice(-4)}`
}

function main() {
  if (!existsSync(SCAN_PATH)) {
    console.error(`[scan:memed-keys] diretório não encontrado: ${SCAN_PATH}`)
    console.error('  Rode `pnpm build` primeiro (gera .next/static/).')
    process.exit(1)
  }

  const offenders = []
  for (const full of walk(SCAN_PATH)) {
    let src
    try {
      src = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    for (const { name, re } of PATTERNS) {
      const hits = [...src.matchAll(re)]
      if (hits.length > 0) {
        const rel = full.replace(/\\/g, '/').replace(/^.*\/\.next\//, '.next/')
        offenders.push({ rel, name, sample: mask(hits[0][0]), count: hits.length })
      }
    }
  }

  if (offenders.length > 0) {
    console.error('[scan:memed-keys] FALHA: possível segredo Memed no bundle do front:')
    for (const o of offenders) {
      console.error(`  ${o.rel}  → ${o.name} ×${o.count} (${o.sample})`)
    }
    console.error('')
    console.error('  Uma chave Memed chegou ao bundle JS entregue ao navegador.')
    console.error('  Localize o arquivo de origem e mova a credencial para o backend.')
    process.exit(1)
  }
  console.info(`[scan:memed-keys] OK — nenhum segredo Memed em ${SCAN_PATH}.`)
}

main()

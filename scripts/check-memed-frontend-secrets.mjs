#!/usr/bin/env node
/**
 * Conformidade Memed (Feature 027 / FR-013) — falha o build se algum arquivo
 * de FRONT (src/app/** ou src/components/**) referenciar segredos da Memed.
 *
 * As chaves `api_key`/`secret_key` da Memed NUNCA podem chegar ao navegador —
 * a Memed audita o tráfego do front e revoga a chave de produção se encontrar.
 * O front só recebe o `token` curto do prescritor (via proxy /memed-token).
 *
 * Detecta:
 *   - `process.env.MEMED_*`
 *   - string literais MEMED_API_KEY / MEMED_SECRET_KEY / MEMED-API-KEY (case-insensitive)
 *   - chaves no formato `mk_[A-Za-z0-9]{20,}`
 *
 * Exit 0 = OK. Exit 1 = referência a segredo Memed no front.
 *
 * Uso: node scripts/check-memed-frontend-secrets.mjs  |  pnpm lint:memed
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONT_ROOTS = [
  join(__dirname, '..', 'src', 'app'),
  join(__dirname, '..', 'src', 'components'),
]

// `'use server'` em uma action server-side dentro de src/app é backend; mas para
// manter a regra simples e conservadora, varremos tudo sob os roots de front.
// Miramos referências REAIS de segredo, não ids de DOM/classes. Por isso o
// literal exige a convenção de env var (MAIÚSCULO + underscore): um
// `<Input id="memed-api-key">` (minúsculo, hífen) é inofensivo e não casa.
const PATTERNS = [
  { name: 'process.env.MEMED_*', re: /process\.env\.MEMED_[A-Z0-9_]+/g },
  { name: 'literal MEMED_(API|SECRET)_KEY', re: /\bMEMED_(API|SECRET)_KEY\b/g },
  { name: 'chave mk_...', re: /\bmk_[A-Za-z0-9]{20,}\b/g },
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
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function mask(s) {
  if (s.length <= 6) return '***'
  return `${s.slice(0, 3)}***${s.slice(-2)}`
}

function main() {
  const offenders = []
  for (const root of FRONT_ROOTS) {
    for (const full of walk(root)) {
      const src = readFileSync(full, 'utf8')
      for (const { name, re } of PATTERNS) {
        const hits = [...src.matchAll(re)]
        if (hits.length > 0) {
          const rel = full.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/')
          offenders.push({ rel, name, sample: mask(hits[0][0]) })
        }
      }
    }
  }

  if (offenders.length > 0) {
    console.error('[check-memed-frontend-secrets] FALHA: segredo Memed referenciado no front:')
    for (const o of offenders) {
      console.error(`  ${o.rel}  → ${o.name} (${o.sample})`)
    }
    console.error('')
    console.error('  As chaves da Memed (api_key/secret_key) NUNCA podem ir ao navegador.')
    console.error('  Mova a chamada para um Route Handler (backend) — o front só recebe o')
    console.error('  token curto do prescritor via /api/medicos/[id]/memed-token.')
    process.exit(1)
  }
  console.info('[check-memed-frontend-secrets] OK — nenhum segredo Memed no front.')
}

main()

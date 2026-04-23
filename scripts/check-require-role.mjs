#!/usr/bin/env node
/**
 * Verifica que todo src/app/api/**\/route.ts que exporta um HTTP verb
 * (GET/POST/PATCH/PUT/DELETE) chama `requireRole(` no arquivo.
 *
 * Rationale: tenant isolation depende de cada Route Handler invocar
 * requireRole antes de criar o service-role client. O guard de
 * call-stack em src/lib/db/supabase-service.ts pega imports vindos de
 * lugares errados, mas NÃO detecta um handler que esqueceu a auth.
 * Este grep cobre esse buraco.
 *
 * Exceções explícitas (paths que autenticam por outro mecanismo):
 *   - /api/webhooks/*   → HMAC do GHL
 *   - /api/workers/*    → assinatura QStash
 *   - /api/platform/*   → PLATFORM_OPERATOR_TOKEN bearer
 *   - /api/health       → endpoint público para uptime monitors
 *
 * Exit 0 = OK. Exit 1 = handlers sem requireRole encontrados.
 *
 * Uso:
 *   node scripts/check-require-role.mjs
 *   pnpm lint:auth
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', 'src', 'app', 'api')

// Caminhos (como aparecem em src/app/api/...) isentos do requireRole.
// Qualquer handler abaixo DEVE autenticar via outro mecanismo; mantemos
// a lista curta e justificada pra que novas exceções sejam deliberadas.
const AUTH_EXEMPT_PREFIXES = [
  'webhooks/',  // HMAC do GHL (tenant_ghl_config.webhook_secret_enc)
  'workers/',   // assinatura QStash (QSTASH_CURRENT_SIGNING_KEY)
  'platform/',  // PLATFORM_OPERATOR_TOKEN (ops globais cross-tenant)
  'health',     // público por design (middleware.ts PUBLIC_PATHS)
]

const HTTP_VERB_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s*\(/g

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (name === 'route.ts') {
      out.push(full)
    }
  }
  return out
}

function relPath(full) {
  const idx = full.replace(/\\/g, '/').indexOf('/src/app/api/')
  return full.replace(/\\/g, '/').slice(idx + '/src/app/api/'.length)
}

function isExempt(rel) {
  return AUTH_EXEMPT_PREFIXES.some((p) => rel.startsWith(p))
}

function main() {
  const files = walk(ROOT)
  const offenders = []

  for (const full of files) {
    const rel = relPath(full)
    if (isExempt(rel)) continue

    const src = readFileSync(full, 'utf8')
    const verbs = [...src.matchAll(HTTP_VERB_RE)].map((m) => m[1])
    if (verbs.length === 0) continue

    const hasRequireRole = /requireRole\s*\(/.test(src)
    if (!hasRequireRole) {
      offenders.push({ rel, verbs })
    }
  }

  if (offenders.length > 0) {
    console.error('[check-require-role] FALHA: handlers sem requireRole()')
    for (const o of offenders) {
      console.error(`  src/app/api/${o.rel}  (${o.verbs.join(', ')})`)
    }
    console.error('')
    console.error('  Cada Route Handler que lê/escreve dados de tenant precisa')
    console.error('  chamar requireRole([...]) antes de criar o service client.')
    console.error('  Se o handler autentica por outro mecanismo (HMAC, bearer),')
    console.error('  adicione o caminho ao AUTH_EXEMPT_PREFIXES neste script.')
    process.exit(1)
  }
  console.info(`[check-require-role] OK — ${files.length} handlers analisados, todos autenticam.`)
}

main()

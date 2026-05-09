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
  'webhooks/',          // HMAC do GHL (tenant_ghl_config.webhook_secret_enc)
  'workers/',           // assinatura QStash (QSTASH_CURRENT_SIGNING_KEY)
  'platform/',          // PLATFORM_OPERATOR_TOKEN (ops globais cross-tenant)
  'health',             // público por design (middleware.ts PUBLIC_PATHS)
  'oauth/ghl/callback', // state HMAC + cookie (feature 008)
  'sso/ghl',            // GHL Marketplace context_token JWT (feature 008)
  'auth/signup',        // signup público (feature 010 US2 — FR-009)
  'onboarding',         // pós-signup, sem tenant claim ainda (feature 010 US2 — FR-014)
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

  // ---- Integration adapters must not read provider secrets from env ----
  //
  // Per research.md R-006 (and FR-002 "mode é por tenant, não por env"),
  // adapters under src/lib/integrations/<provider>/* must receive their
  // credentials via AdapterContext, not via process.env.GHL_* /
  // process.env.SUPABASE_OPERATIONS_* /etc. The GHL adapter keeps a
  // legacy env fallback for the proxy URL+anon key (shared infra, not
  // per-tenant secret); the lint rule only flags raw secret names.
  const INTEGRATIONS_ROOT = join(__dirname, '..', 'src', 'lib', 'integrations')
  // Generic per-provider secrets (GHL legacy LOCATION_ID + future placeholders).
  const FORBIDDEN_ENV_RE = /process\.env\.(GHL_LOCATION_ID|HUBSPOT_[A-Z_]+|RDSTATION_[A-Z_]+|PIPEDRIVE_[A-Z_]+)/g
  // GHL OAuth/Marketplace/SSO env vars (feature 008): allowed ONLY inside the
  // oauth/ capsule (src/lib/integrations/ghl/oauth/**). Any other adapter file
  // reading these is a regression — credentials per-tenant come via
  // AdapterContext / withGhlAuth, not env.
  const FORBIDDEN_OAUTH_ENV_RE = /process\.env\.(GHL_CLIENT_ID|GHL_CLIENT_SECRET|GHL_REDIRECT_URI|GHL_SCOPES|GHL_MARKETPLACE_SHARED_SECRET|GHL_SSO_[A-Z_]+)/g
  const adapterOffenders = []
  for (const full of walkTS(INTEGRATIONS_ROOT)) {
    const rel = full.replace(/\\/g, '/')
    // Skip types.ts and registry.ts — they don't make outbound calls.
    if (/\/types\.ts$/.test(rel) || /\/registry\.ts$/.test(rel)) continue

    const src = readFileSync(full, 'utf8')
    const hits = [...src.matchAll(FORBIDDEN_ENV_RE)]
    if (hits.length > 0) {
      adapterOffenders.push({ rel: rel.slice(rel.indexOf('/src/lib/') + 1), hits: hits.map((h) => h[1]) })
    }

    // GHL OAuth env: permitido somente em src/lib/integrations/ghl/oauth/**
    const isInsideOauthCapsule = /\/src\/lib\/integrations\/ghl\/oauth\//.test(rel)
    if (!isInsideOauthCapsule) {
      const oauthHits = [...src.matchAll(FORBIDDEN_OAUTH_ENV_RE)]
      if (oauthHits.length > 0) {
        adapterOffenders.push({
          rel: rel.slice(rel.indexOf('/src/lib/') + 1),
          hits: oauthHits.map((h) => h[1]),
        })
      }
    }
  }
  if (adapterOffenders.length > 0) {
    console.error('\n[check-require-role] FALHA: adapters lendo secrets direto de env:')
    for (const o of adapterOffenders) {
      console.error(`  ${o.rel}  → ${o.hits.join(', ')}`)
    }
    console.error('')
    console.error('  Credenciais por provider vivem em tenant_integrations.credentials_enc')
    console.error('  e chegam ao adapter via AdapterContext. Envs globais ficam reservados')
    console.error('  para infra compartilhada (SUPABASE_OPERATIONS_URL / ANON_KEY do proxy).')
    process.exit(1)
  }
  console.info('[check-require-role] OK — adapters não lêem secrets de env diretamente.')
}

function walkTS(dir) {
  const out = []
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        out.push(...walkTS(full))
      } else if (/\.(ts|tsx)$/.test(name)) {
        out.push(full)
      }
    }
  } catch {
    // Directory may not exist yet — that's fine.
  }
  return out
}

main()

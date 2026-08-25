/**
 * Global Vitest setup. Loads env vars, ensures Supabase local is running,
 * resets the DB to migrations baseline before each test file.
 */
import { beforeAll, afterAll, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mswServer } from './msw-server'
import { resetAllSpies, resendArchive, piiRegistry } from './msw-spies'

// Load .env.test if present, otherwise fall back to .env.local
const envFile = ['.env.test', '.env.local'].find((f) => existsSync(join(process.cwd(), f)))
if (envFile) {
  const lines = readFileSync(envFile, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match) {
      const k = match[1]
      const raw = match[2]
      if (!k || raw === undefined) continue
      const v = raw.replace(/^"|"$/g, '')
      if (!process.env[k]) process.env[k] = v
    }
  }
}

;(process.env as Record<string, string>).NODE_ENV = 'test'
process.env.LOG_LEVEL ??= 'warn'

// Feature 008 — defaults seguros para tests não exigirem .env.test custom.
// Produção lê de variáveis reais; aqui usamos placeholders e a suíte
// intercepta `services.leadconnectorhq.com` via MSW.
process.env.GHL_CLIENT_ID ??= 'test_client_id'
process.env.GHL_CLIENT_SECRET ??= 'test_client_secret_minimum_length_xxx'
process.env.GHL_REDIRECT_URI ??= 'http://localhost:3000/api/oauth/ghl/callback'
process.env.GHL_SCOPES ??=
  'contacts.readonly,contacts.write,custom-fields.readonly,custom-fields.write,locations.readonly,opportunities.write,webhooks.readonly,webhooks.write'
process.env.GHL_MARKETPLACE_SHARED_SECRET ??= 'test_marketplace_shared_secret_min_32_chars_xxxx'
process.env.GHL_SSO_JWKS_URL ??= 'https://services.leadconnectorhq.com/.well-known/jwks.json'

// Feature 051 — TRAVA DE SEGURANÇA. O bloco acima carrega .env.local, que em
// máquina de desenvolvimento tem a URL REAL do serviço de WhatsApp. Sem este
// override, um teste de integração que chegasse em `sendText` mandaria mensagem
// de verdade, pela Evolution de produção, para o telefone que estivesse no
// fixture. Forçamos um host fake — o MSW intercepta e devolve resposta
// sintética. É `=` e não `??=` DE PROPÓSITO: precisa sobrescrever.
process.env.WHATSAPP_SERVICE_URL = 'https://whatsapp-service.test/functions/v1'
process.env.WHATSAPP_SERVICE_MASTER_KEY = 'test-master-key'

// MESMA TRAVA, mesmo motivo. Sem chave, `sendAlertEmail` desiste ANTES do
// HTTP e devolve `{id:null}` — então o espião do MSW não vê chamada nenhuma e
// todo teste que confere o conteúdo de um e-mail de alerta falha por vazio, em
// vez de por conteúdo errado. Era isso que quebrava `alert-email-no-pii` e
// `webhook-missing-field` SÓ na CI: na máquina de desenvolvimento a chave vem
// do .env.local, e o defeito ficava invisível.
//
// `=` e não `??=`, como no WhatsApp: com a chave REAL do .env.local, um teste
// que escapasse do MSW mandaria e-mail de verdade.
process.env.RESEND_API_KEY = 'test_resend_api_key'
process.env.RESEND_FROM = 'alertas@clinni.test'

// Feature 030 — segredo do cookie HMAC do portal do paciente. Produção usa
// env dedicado; nos testes basta um valor estável e forte o bastante.
process.env.PATIENT_SESSION_SECRET ??= 'test_patient_session_secret_min_32_chars_xxxxxxxx'

beforeAll(() => {
  // Confirm Supabase local is up; if not, surface a clear error.
  // We deliberately don't start it automatically — developers should
  // run `pnpm supabase:start` explicitly in another terminal, keeping
  // the container alive across multiple test runs.
  try {
    execSync('supabase status --workdir .', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'Supabase local is not running. Start it with `pnpm supabase:start` before running integration tests. ' +
        '(Constitution Section 3 forbids mocking the DB for integration tests.)',
    )
  }

  // Intercept outbound HTTP (Resend, QStash) so tests can assert what the
  // production code tried to send. Only relays matching URLs are mocked;
  // Supabase traffic on 127.0.0.1 is passed through unchanged.
  mswServer.listen({ onUnhandledRequest: 'bypass' })
}, 30_000)

afterEach(() => {
  resetAllSpies()
  mswServer.resetHandlers()
})

afterAll(() => {
  // Global PII scan (SC-013, T151): every Resend call captured during
  // this test file is checked against the suite-wide PII registry —
  // patient names, CPFs, phones, emails, birth dates seeded anywhere
  // since the process started. A hit means a regression: an alert
  // email embedded a value that FR-037 forbids. Failing here forces a
  // fix before the suite can turn green.
  const leaks: string[] = []
  for (const call of resendArchive.calls) {
    const haystack = [call.subject ?? '', call.body ?? '', call.html ?? ''].join('\n')
    for (const token of piiRegistry.tokens) {
      if (haystack.includes(token)) {
        leaks.push(`subject="${call.subject ?? ''}" leaked token "${token}"`)
      }
    }
  }
  mswServer.close()
  if (leaks.length > 0) {
    throw new Error(`SC-013 violation — alert email contained seeded PII:\n  ${leaks.join('\n  ')}`)
  }
})

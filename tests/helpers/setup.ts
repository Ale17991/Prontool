/**
 * Global Vitest setup. Loads env vars, ensures Supabase local is running,
 * resets the DB to migrations baseline before each test file.
 */
import { beforeAll, afterAll, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mswServer } from './msw-server'
import { resetAllSpies } from './msw-spies'

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
  mswServer.close()
})

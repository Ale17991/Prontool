/**
 * T065 (Feature 017) — unit test para verifyTurnstile.
 *
 * Mocka `fetch` global para simular respostas da API siteverify da
 * Cloudflare. Verifica:
 *   - sucesso quando success=true
 *   - falha quando success=false (com error-codes)
 *   - bypass automático em dev sem secret
 *   - falha em prod sem secret
 *   - falha em network error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { verifyTurnstile } from '@/lib/core/public-booking/turnstile-verify'

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('bypassa em dev sem secret', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    vi.stubEnv('NODE_ENV', 'development')
    const r = await verifyTurnstile('dev-token')
    expect(r.ok).toBe(true)
    expect(r.bypass).toBe(true)
  })

  it('falha em prod sem secret', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    const r = await verifyTurnstile('any-token')
    expect(r.ok).toBe(false)
    expect(r.errorCodes).toContain('missing-secret-server-side')
  })

  it('falha quando token vazio', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('NODE_ENV', 'production')
    const r = await verifyTurnstile('')
    expect(r.ok).toBe(false)
    expect(r.errorCodes).toContain('missing-input-response')
  })

  it('aceita quando siteverify retorna success=true', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    const r = await verifyTurnstile('valid-token')
    expect(r.ok).toBe(true)
  })

  it('rejeita quando siteverify retorna success=false', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
        { status: 200 },
      ),
    )
    const r = await verifyTurnstile('invalid-token')
    expect(r.ok).toBe(false)
    expect(r.errorCodes).toContain('invalid-input-response')
  })

  it('retorna network error em fetch failure', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'))
    const r = await verifyTurnstile('any-token')
    expect(r.ok).toBe(false)
    expect(r.errorCodes).toContain('siteverify-network')
  })
})

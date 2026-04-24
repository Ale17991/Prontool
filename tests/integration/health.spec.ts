/**
 * /api/health — liveness + readiness probe used by Vercel/uptime monitors
 * and by the deploy smoke tests in docs/deploy.md §6. Happy path must
 * return 200 when the local stack is up; failure paths are covered by the
 * route handler's defensive checks but are awkward to simulate in an
 * integration test without flipping real extensions on/off.
 */
import { describe, it, expect } from 'vitest'

describe('GET /api/health', () => {
  it('returns 200 ok when DB, migrations, auth hook, and pgcrypto are present', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; failing?: string[] }
    expect(body.status).toBe('ok')
    expect(body.failing).toBeUndefined()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

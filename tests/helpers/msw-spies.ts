/**
 * Test-side interception spies for outbound HTTP (Resend, QStash, GHL API).
 * Records calls as plain objects so integration tests can assert on what the
 * worker tried to send without needing live network access.
 *
 * `resendSpy` and `qstashSpy` reset between tests (afterEach in setup.ts).
 * `resendArchive` and `piiRegistry` DO NOT reset — they accumulate across
 * the whole suite so the global PII scan (T151, SC-013) can assert no
 * email body ever contained any seeded PII token. See the `afterAll` hook
 * in tests/helpers/setup.ts.
 */

export interface ResendCall {
  to?: string[] | string
  subject?: string
  body?: string
  html?: string
}

export interface QstashCall {
  url?: string
  body?: unknown
}

class CallRecorder<T> {
  readonly calls: T[] = []
  reset(): void {
    this.calls.length = 0
  }
  record(call: T): void {
    this.calls.push(call)
  }
}

export const resendSpy = new CallRecorder<ResendCall>()
export const qstashSpy = new CallRecorder<QstashCall>()

/**
 * Feature 008 — GHL OAuth token endpoint spy + per-test response override.
 *
 * Cada chamada a `https://services.leadconnectorhq.com/oauth/token` é
 * registrada em `ghlOauthTokenSpy.calls`. Por default o mock responde 200
 * com `defaultGhlTokenResponse()`. Tests podem sobrescrever o próximo N
 * responses via `ghlOauthTokenSpy.queueResponse({ status, body })`.
 */
export interface GhlOauthTokenCall {
  body: URLSearchParams
  bodyRaw: string
  headers: Record<string, string>
}

export interface GhlOauthTokenResponse {
  status: number
  body: Record<string, unknown> | string
}

class OauthTokenSpy {
  readonly calls: GhlOauthTokenCall[] = []
  private queue: GhlOauthTokenResponse[] = []
  reset(): void {
    this.calls.length = 0
    this.queue.length = 0
  }
  record(call: GhlOauthTokenCall): void {
    this.calls.push(call)
  }
  queueResponse(res: GhlOauthTokenResponse): void {
    this.queue.push(res)
  }
  nextResponse(): GhlOauthTokenResponse {
    return this.queue.shift() ?? defaultGhlTokenResponse()
  }
}

export const ghlOauthTokenSpy = new OauthTokenSpy()

export function defaultGhlTokenResponse(): GhlOauthTokenResponse {
  return {
    status: 200,
    body: {
      access_token: `at_test_${Math.random().toString(36).slice(2)}_xxxxxxxxxxxxxxxxxxxxxx`,
      refresh_token: `rt_test_${Math.random().toString(36).slice(2)}_xxxxxxxxxxxxxxxxxxxxxx`,
      expires_in: 86400,
      scope: 'contacts.readonly contacts.write',
      userType: 'Location',
      locationId: 'loc_test_default',
      companyId: 'comp_test_default',
      userId: 'usr_test_default',
    },
  }
}

/**
 * Helper para tests: gera uma resposta com `locationId` configurável.
 */
export function makeGhlTokenResponse(overrides: {
  locationId?: string
  companyId?: string
  userId?: string
  expiresIn?: number
  scope?: string
} = {}): GhlOauthTokenResponse {
  const base = defaultGhlTokenResponse().body as Record<string, unknown>
  return {
    status: 200,
    body: {
      ...base,
      locationId: overrides.locationId ?? 'loc_test_default',
      companyId: overrides.companyId ?? 'comp_test_default',
      userId: overrides.userId ?? 'usr_test_default',
      expires_in: overrides.expiresIn ?? 86400,
      scope: overrides.scope ?? 'contacts.readonly contacts.write',
    },
  }
}

/**
 * Suite-wide archive of every Resend call. Never reset; consumed by the
 * end-of-file PII scanner in setup.ts.
 */
export const resendArchive = new CallRecorder<ResendCall>()

/**
 * PII tokens seeded somewhere in the suite. The scanner asserts none of
 * these ever appear in `resendArchive`. Uses a Set for dedup. Tokens
 * shorter than 3 chars are rejected to avoid meaningless matches.
 */
class PiiRegistry {
  readonly tokens = new Set<string>()
  register(...values: Array<string | null | undefined>): void {
    for (const v of values) {
      if (typeof v === 'string' && v.length >= 3) this.tokens.add(v)
    }
  }
  reset(): void {
    this.tokens.clear()
  }
}
export const piiRegistry = new PiiRegistry()

export function resetAllSpies(): void {
  resendSpy.reset()
  qstashSpy.reset()
  ghlOauthTokenSpy.reset()
  // resendArchive and piiRegistry intentionally persist.
}

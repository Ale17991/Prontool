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
  // resendArchive and piiRegistry intentionally persist.
}

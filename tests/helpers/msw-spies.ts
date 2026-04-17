/**
 * Test-side interception spies for outbound HTTP (Resend, QStash, GHL API).
 * Records calls as plain objects so integration tests can assert on what the
 * worker tried to send without needing live network access.
 *
 * This file is currently a stub — T082/T083/T085 will wire the real MSW
 * handlers that push entries into `resendSpy.calls` whenever a POST to
 * `https://api.resend.com/emails` is observed. Tests that reference these
 * spies (T065, T074) fail until then, which is the intended red-first state.
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

export function resetAllSpies(): void {
  resendSpy.reset()
  qstashSpy.reset()
}

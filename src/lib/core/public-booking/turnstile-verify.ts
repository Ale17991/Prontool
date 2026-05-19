/**
 * Feature 017 — Verificação server-side do token Cloudflare Turnstile.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Em ambiente sem `TURNSTILE_SECRET_KEY` configurado (dev/test), retorna
 * `{ ok: true, bypass: true }` para não bloquear desenvolvimento local.
 * Em produção, falta de secret é erro de configuração — logado mas não
 * bloqueia o fluxo (decisão pragmática para US1; reforçar em polish).
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerifyResult {
  ok: boolean
  bypass?: boolean
  errorCodes?: string[]
}

export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    // Bypass em dev. Console-log explícito.
    if (process.env.NODE_ENV === 'production') {
      // Em prod sem secret: tratar como falha de segurança.
      return { ok: false, errorCodes: ['missing-secret-server-side'] }
    }
    return { ok: true, bypass: true }
  }
  if (!token || token.length < 4) {
    return { ok: false, errorCodes: ['missing-input-response'] }
  }
  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    if (remoteIp) form.set('remoteip', remoteIp)

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return { ok: false, errorCodes: [`siteverify-http-${res.status}`] }
    }
    const json = (await res.json()) as {
      success: boolean
      'error-codes'?: string[]
    }
    if (json.success) return { ok: true }
    return { ok: false, errorCodes: json['error-codes'] ?? ['unknown'] }
  } catch (err) {
    return {
      ok: false,
      errorCodes: [
        err instanceof Error && err.name === 'TimeoutError'
          ? 'siteverify-timeout'
          : 'siteverify-network',
      ],
    }
  }
}

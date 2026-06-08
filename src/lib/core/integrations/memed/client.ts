import { DomainError } from '@/lib/observability/errors'
import type { MemedCredentials, MemedEnvironment } from './types'

/**
 * Client HTTP da Memed — ÚNICO lugar autorizado a chamar a API da Memed e o
 * ÚNICO que vê as credenciais em texto claro (Feature 026).
 *
 * Garantias de segurança (conformidade 027):
 *  - `api-key`/`secret-key` vão na query string, server-side apenas.
 *  - A URL completa (que contém as chaves) NUNCA entra em mensagem de erro,
 *    `cause`, ou log. Erros carregam só mensagem genérica + status.
 *  - Timeout de 5s via `AbortSignal.timeout`.
 *  - JSON:API (`application/vnd.api+json`).
 */

const BASE_URLS: Record<MemedEnvironment, string> = {
  staging: 'https://integrations.api.memed.com.br/v1',
  production: 'https://api.memed.com.br/v1',
}

/**
 * Override de teste (spec 027, contracts/memed-mock.md): quando `MEMED_BASE_URL`
 * está definida — só no E2E, apontando para o mock local — ela substitui o base
 * URL de qualquer ambiente. NUNCA definir em produção.
 */
function resolveBaseUrl(environment: MemedEnvironment): string {
  return process.env.MEMED_BASE_URL || BASE_URLS[environment]
}

/** 4xx de validação da Memed — mensagem amigável apontando o problema (HTTP 422). */
export class MemedValidationError extends DomainError {
  readonly memedStatus: number
  readonly memedErrors: unknown
  constructor(message: string, memedStatus: number, memedErrors: unknown) {
    super('MEMED_VALIDATION', message, { status: 422, meta: { memed_status: memedStatus } })
    this.memedStatus = memedStatus
    this.memedErrors = memedErrors
  }
}

/** timeout / 5xx / network — Memed indisponível (HTTP 502). */
export class MemedUpstreamError extends DomainError {
  constructor(message: string, status: number | null = null) {
    super('MEMED_UPSTREAM', message, status ? { status: 502, meta: { upstream_status: status } } : { status: 502 })
  }
}

export interface MemedRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Caminho relativo ao baseURL, ex.: `/sinapse-prescricao/usuarios`. */
  path: string
  body?: unknown
  query?: Record<string, string>
}

/** Extrai a primeira mensagem útil de um corpo de erro JSON:API. */
function extractMemedMessage(json: unknown): string | null {
  if (json && typeof json === 'object' && 'errors' in json) {
    const errors = (json as { errors?: unknown }).errors
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as { detail?: unknown; title?: unknown }
      const msg = first.detail ?? first.title
      if (typeof msg === 'string' && msg.length > 0) return msg
    }
  }
  return null
}

/**
 * Executa uma chamada à Memed. Genérico no tipo de resposta esperado.
 * Lança `MemedValidationError` (4xx) ou `MemedUpstreamError` (timeout/5xx/rede).
 */
export async function memedFetch<T = unknown>(
  environment: MemedEnvironment,
  credentials: MemedCredentials,
  req: MemedRequest,
): Promise<T> {
  // URL com segredos — mantida estritamente local a esta função.
  const url = new URL(resolveBaseUrl(environment) + req.path)
  url.searchParams.set('api-key', credentials.api_key)
  url.searchParams.set('secret-key', credentials.secret_key)
  for (const [k, v] of Object.entries(req.query ?? {})) {
    url.searchParams.set(k, v)
  }

  const headers: Record<string, string> = { Accept: 'application/vnd.api+json' }
  if (req.body !== undefined) headers['Content-Type'] = 'application/vnd.api+json'

  let res: Response
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Não propagar o erro original — ele pode conter a URL com as chaves.
    throw new MemedUpstreamError('Memed indisponível, tente novamente')
  }

  const text = await res.text()
  let json: unknown
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
  }

  if (res.ok) return json as T

  if (res.status >= 400 && res.status < 500) {
    throw new MemedValidationError(
      extractMemedMessage(json) ?? 'Dados inválidos para a Memed.',
      res.status,
      json,
    )
  }

  throw new MemedUpstreamError('Memed indisponível, tente novamente', res.status)
}

/** Base URL pública por ambiente (sem segredos) — útil para testes/diagnóstico. */
export function memedBaseUrl(environment: MemedEnvironment): string {
  return resolveBaseUrl(environment)
}

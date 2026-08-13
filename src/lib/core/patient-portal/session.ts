import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Feature 030 — sessão do paciente: cookie HMAC-SHA256 stateless.
 *
 * Mesmo esquema de `src/lib/integrations/ghl/oauth/state.ts`:
 * `<payloadBase64Url>.<hmacSha256Hex>`, assinado com segredo dedicado de
 * servidor (`PATIENT_SESSION_SECRET`). O payload carrega `patientId` +
 * `tenantId` verificados pelo login (RPC `patient_portal_verify_login`) e
 * o TTL — sem hit de banco por request.
 *
 * Invariante de segurança (contracts/patient-session.md): o cookie é a
 * ÚNICA fonte de patientId/tenantId nos endpoints `/api/paciente/*`.
 * Inválido/expirado ⇒ tratar como não autenticado (401), sem detalhe.
 */

export const PATIENT_SESSION_COOKIE_NAME = 'clinni-patient-session'
/**
 * 30 min — desde a 057, de **inatividade**: cada página aberta empurra o prazo
 * (a renovação acontece no middleware). Antes era a duração total, e com o
 * portal em várias páginas isso passaria a interromper um percurso, não uma
 * tela só.
 */
export const PATIENT_SESSION_MAX_AGE_SECONDS = 1800
/**
 * Teto absoluto: 12h desde o login, por mais ativo que o paciente esteja.
 *
 * A autenticação aqui é fraca por decisão de produto (CPF + data de
 * nascimento). Sem teto, renovar por atividade deixaria uma aba esquecida num
 * aparelho compartilhado viva para sempre — a janela de inatividade sozinha
 * protege contra abandono, não contra permanência.
 */
export const PATIENT_SESSION_ABSOLUTE_MAX_AGE_SECONDS = 12 * 60 * 60

export interface PatientSessionPayload {
  patientId: string
  tenantId: string
  iatMs: number
  expMs: number
}

function readPatientSessionSecret(): string {
  const secret = process.env.PATIENT_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'PATIENT_SESSION_SECRET ausente ou curto demais (mínimo 32 chars). ' +
        'Defina um segredo forte no ambiente do servidor.',
    )
  }
  return secret
}

function signHex(input: string): string {
  return createHmac('sha256', readPatientSessionSecret()).update(input).digest('hex')
}

function encode(payload: PatientSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${signHex(body)}`
}

/** Produz o valor do cookie de sessão para um login verificado. */
export function createPatientSessionCookie(args: {
  patientId: string
  tenantId: string
  nowMs?: number
}): string {
  const now = args.nowMs ?? Date.now()
  return encode({
    patientId: args.patientId,
    tenantId: args.tenantId,
    iatMs: now,
    expMs: now + PATIENT_SESSION_MAX_AGE_SECONDS * 1000,
  })
}

/**
 * Renova a janela de inatividade: empurra `expMs` e **preserva `iatMs`**.
 *
 * Reescrever `iatMs` tornaria o teto absoluto inalcançável — a sessão se
 * renovaria para sempre e os 12h nunca chegariam. Retorna `null` quando o
 * cookie atual já não vale (assinatura, inatividade ou teto): renovar aqui seria
 * ressuscitar sessão morta, e o middleware não valida credencial, só estende a
 * que já é válida.
 */
export function renewPatientSessionCookie(
  cookieValue: string | null | undefined,
  nowMs?: number,
): string | null {
  const payload = verifyPatientSessionCookie(cookieValue, nowMs)
  if (!payload) return null
  const now = nowMs ?? Date.now()
  return encode({
    ...payload,
    expMs: now + PATIENT_SESSION_MAX_AGE_SECONDS * 1000,
  })
}

/**
 * Verifica o cookie. Retorna o payload quando a assinatura confere E a
 * sessão não expirou; caso contrário retorna `null` — o caller responde
 * 401 genérico, sem distinguir o motivo.
 */
export function verifyPatientSessionCookie(
  cookieValue: string | null | undefined,
  nowMs?: number,
): PatientSessionPayload | null {
  if (!cookieValue) return null
  const lastDot = cookieValue.lastIndexOf('.')
  if (lastDot <= 0) return null
  const body = cookieValue.slice(0, lastDot)
  const sig = cookieValue.slice(lastDot + 1)

  const expected = signHex(body)
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) {
    return null
  }

  let payload: PatientSessionPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PatientSessionPayload
  } catch {
    return null
  }
  if (
    typeof payload.patientId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.iatMs !== 'number' ||
    typeof payload.expMs !== 'number'
  ) {
    return null
  }

  const now = nowMs ?? Date.now()
  // Duas mortes possíveis, e o caller não distingue nenhuma delas: inatividade
  // (expMs, empurrado a cada página) e teto absoluto (iatMs + 12h, imóvel).
  if (now >= payload.expMs) return null
  if (now - payload.iatMs >= PATIENT_SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000) return null
  return payload
}

/**
 * Extrai e verifica a sessão a partir do header `Cookie` de uma Request.
 * Retorna `null` quando ausente/inválida/expirada (caller responde 401).
 */
export function readPatientSessionFromRequest(
  req: Request,
  nowMs?: number,
): PatientSessionPayload | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    if (name !== PATIENT_SESSION_COOKIE_NAME) continue
    const value = decodeURIComponent(part.slice(eq + 1).trim())
    return verifyPatientSessionCookie(value, nowMs)
  }
  return null
}

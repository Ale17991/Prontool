/**
 * Regressões dos fixes C1, C2, H3 (verify-sso-token).
 *
 * - C1: `exp` ausente devia rejeitar (antes: aceitava indefinidamente).
 * - C2: `aud` ausente ou divergente devia rejeitar (antes: SSO_AUDIENCE
 *       em module-level virava '' em build/cold-start sem env, e a checagem
 *       inteira ficava no-op).
 * - H3: `iss` com prefixo válido seguido de chars que não são '/' devia
 *       rejeitar (antes: `startsWith(i)` aceitava subdomain hijack).
 *
 * NOTA: Tests usam MSW para servir o JWKS local (RSA gerado on-the-fly).
 * A mesma chave assina os JWTs do test — então a checagem de signature
 * passa e podemos isolar a verificação semântica dos claims.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto'
import { http, HttpResponse } from 'msw'
import { mswServer } from '@/tests/helpers/msw-server'
import {
  verifySsoToken,
  InvalidSsoTokenError,
  _resetJwksCacheForTests,
} from '@/lib/integrations/ghl/oauth/verify-sso-token'

interface KeyPair {
  privatePem: string
  publicJwk: {
    kty: 'RSA'
    n: string
    e: string
    kid: string
    use: 'sig'
    alg: 'RS256'
  }
}

function generateRsaPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string }
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    publicJwk: {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e,
      kid: randomBytes(8).toString('hex'),
      use: 'sig',
      alg: 'RS256',
    },
  }
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function mintRs256Jwt(privatePem: string, kid: string, claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT', kid }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(claims))
  const signed = `${h}.${p}`
  const sig = createSign('RSA-SHA256').update(signed, 'utf8').sign(privatePem)
  return `${signed}.${b64url(sig)}`
}

const SSO_JWKS_URL = 'https://services.leadconnectorhq.com/.well-known/jwks.json'
const SSO_AUDIENCE = 'test_client_id' // bate com process.env.GHL_CLIENT_ID em setup.ts

describe('security: verify-sso-token', () => {
  let keys: KeyPair

  beforeAll(() => {
    keys = generateRsaPair()
  })

  beforeEach(() => {
    _resetJwksCacheForTests()
    mswServer.use(
      http.get(SSO_JWKS_URL, () => HttpResponse.json({ keys: [keys.publicJwk] })),
    )
  })

  afterAll(() => {
    _resetJwksCacheForTests()
  })

  // ===== Baseline: happy path para isolar regressões dos rejects =====
  it('happy: JWT com exp, aud e iss válidos → aceita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      iss: 'https://services.leadconnectorhq.com',
      aud: SSO_AUDIENCE,
      iat: nowSec,
      exp: nowSec + 600,
      locationId: 'loc_test',
      userId: 'usr_test',
      userType: 'Location',
    })
    const claims = await verifySsoToken(jwt)
    expect(claims.locationId).toBe('loc_test')
    expect(claims.userId).toBe('usr_test')
  })

  // ===== C1: exp obrigatório =====
  it('C1: JWT sem claim exp → rejeita InvalidSsoTokenError', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      iss: 'https://services.leadconnectorhq.com',
      aud: SSO_AUDIENCE,
      iat: nowSec,
      // exp ausente — antes da correção, passaria indefinidamente.
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    await expect(verifySsoToken(jwt)).rejects.toBeInstanceOf(InvalidSsoTokenError)
    await expect(verifySsoToken(jwt)).rejects.toMatchObject({ reason: 'exp claim missing' })
  })

  it('C1: JWT com exp no passado → rejeita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      iss: 'https://services.leadconnectorhq.com',
      aud: SSO_AUDIENCE,
      iat: nowSec - 7200,
      exp: nowSec - 3600,
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    await expect(verifySsoToken(jwt)).rejects.toMatchObject({ reason: 'exp in the past' })
  })

  // ===== C2: aud obrigatório e exato =====
  it('C2: JWT sem claim aud → rejeita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      iss: 'https://services.leadconnectorhq.com',
      // aud ausente — antes, se SSO_AUDIENCE='' no module-level, esta
      // checagem virava no-op.
      iat: nowSec,
      exp: nowSec + 600,
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    await expect(verifySsoToken(jwt)).rejects.toMatchObject({ reason: 'aud claim missing' })
  })

  it('C2: JWT com aud divergente → rejeita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      iss: 'https://services.leadconnectorhq.com',
      aud: 'some_other_client_id',
      iat: nowSec,
      exp: nowSec + 600,
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    await expect(verifySsoToken(jwt)).rejects.toMatchObject({ reason: 'aud mismatch' })
  })

  // ===== H3: iss com prefixo válido + caracteres não-'/' deve falhar =====
  it('H3: iss com subdomain hijack (prefix match mas não path) → rejeita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      // Antes: `startsWith('https://marketplace.gohighlevel.com')` retornava
      // true para esta string — atacante com subdomain controlado bypassava.
      iss: 'https://marketplace.gohighlevel.com.attacker.example',
      aud: SSO_AUDIENCE,
      iat: nowSec,
      exp: nowSec + 600,
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    await expect(verifySsoToken(jwt)).rejects.toMatchObject({
      reason: 'iss missing or not allowed',
    })
  })

  it('H3: iss com path suffix legítimo (/oauth) → aceita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      iss: 'https://services.leadconnectorhq.com/oauth',
      aud: SSO_AUDIENCE,
      iat: nowSec,
      exp: nowSec + 600,
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    const claims = await verifySsoToken(jwt)
    expect(claims.iss).toBe('https://services.leadconnectorhq.com/oauth')
  })

  // Hardening (revisão 2026-07): iss é OBRIGATÓRIO. Antes, um token que
  // simplesmente omitia `iss` pulava a checagem do allow-list.
  it('iss ausente → rejeita', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const jwt = mintRs256Jwt(keys.privatePem, keys.publicJwk.kid, {
      aud: SSO_AUDIENCE,
      iat: nowSec,
      exp: nowSec + 600,
      locationId: 'loc_test',
      userId: 'usr_test',
    })
    await expect(verifySsoToken(jwt)).rejects.toMatchObject({
      reason: 'iss missing or not allowed',
    })
  })
})

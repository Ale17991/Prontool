/**
 * T016 (Feature 029 / US1) — upload do certificado ICP-Brasil A1.
 *  - Upload de .pfx válido lê CN/validade, cifra e persiste; a resposta NÃO
 *    contém o conteúdo do certificado nem a senha.
 *  - Senha errada → 400.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import forge from 'node-forge'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

/** Gera um .pfx A1 self-signed para teste e devolve os bytes DER. */
function makeTestPfx(password: string, cn = 'CLINICA TESTE:00000000000191'): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  const attrs = [{ name: 'commonName', value: cn }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey)
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
  const der = forge.asn1.toDer(p12).getBytes()
  return Uint8Array.from(der, (c) => c.charCodeAt(0))
}

async function setup(slug: string) {
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  return { tenantId, jwt }
}

function uploadReq(jwt: string, der: Uint8Array, password: string): Request {
  const form = new FormData()
  form.append(
    'certificate',
    new File([der as unknown as BlobPart], 'cert.pfx', { type: 'application/x-pkcs12' }),
  )
  form.append('password', password)
  return new Request('http://localhost/api/tiss/certificados', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  })
}

describe('Feature 029 — upload de certificado A1 (US1)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('aceita .pfx válido, persiste cifrado e não vaza o conteúdo na resposta', async () => {
    const { tenantId, jwt } = await setup('tiss-cert-ok')
    const der = makeTestPfx('senha-teste-123')
    const { POST } = await import('@/app/api/tiss/certificados/route')
    const res = await POST(uploadReq(jwt, der, 'senha-teste-123'))
    expect(res.status).toBe(201)
    const raw = await res.text()
    expect(raw).toContain('subjectCn')
    expect(raw).not.toMatch(/senha-teste-123/)
    expect(raw).not.toMatch(/pfx_enc|password_enc|BEGIN (CERTIFICATE|PRIVATE)/i)

    const sb = serviceClient()
    const { data } = await sb
      .from('tenant_tiss_certificates')
      .select('subject_cn, active, pfx_enc')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single()
    expect(data?.active).toBe(true)
    expect(data?.subject_cn).toContain('CLINICA TESTE')
    expect(data?.pfx_enc).toBeTruthy()
  })

  it('rejeita senha errada com 400', async () => {
    const { jwt } = await setup('tiss-cert-badpass')
    const der = makeTestPfx('senha-correta')
    const { POST } = await import('@/app/api/tiss/certificados/route')
    const res = await POST(uploadReq(jwt, der, 'senha-errada'))
    expect(res.status).toBe(400)
  })
})

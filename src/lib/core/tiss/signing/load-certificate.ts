import forge from 'node-forge'
import { TissInvalidCertificateError } from '../errors'

/**
 * Feature 029 — leitura do certificado ICP-Brasil A1 (.pfx/.p12) com node-forge.
 *
 * US1 usa `readCertificateInfo` para validar a senha e extrair CN + validade na
 * hora do upload. US4 usa `loadCertificateForSigning` para obter o PEM do
 * certificado + chave privada (assinatura XMLDSig do lote). O conteúdo do
 * certificado nunca é logado nem retornado ao browser.
 */

export interface CertificateInfo {
  subjectCn: string
  notAfter: Date
}

function openPkcs12(pfxBase64: string, password: string): forge.pkcs12.Pkcs12Pfx {
  try {
    const der = forge.util.decode64(pfxBase64)
    const asn1 = forge.asn1.fromDer(der)
    return forge.pkcs12.pkcs12FromAsn1(asn1, password)
  } catch {
    throw new TissInvalidCertificateError(
      'Não foi possível abrir o certificado — verifique se é um arquivo .pfx/.p12 válido e se a senha está correta.',
    )
  }
}

const CERT_BAG = forge.pki.oids.certBag as string
const KEY_BAG = forge.pki.oids.pkcs8ShroudedKeyBag as string

function leafCertificate(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate {
  const bags = p12.getBags({ bagType: CERT_BAG })[CERT_BAG] ?? []
  const cert = bags[0]?.cert
  if (!cert) {
    throw new TissInvalidCertificateError('Certificado não contém uma cadeia válida.')
  }
  return cert
}

/** Valida senha + formato e extrai CN do titular e data de expiração. */
export function readCertificateInfo(pfxBase64: string, password: string): CertificateInfo {
  const p12 = openPkcs12(pfxBase64, password)
  const cert = leafCertificate(p12)
  const cnField = cert.subject.getField('CN') as { value?: string } | null
  const subjectCn = cnField?.value ?? 'Certificado ICP-Brasil'
  return { subjectCn, notAfter: cert.validity.notAfter }
}

export interface CertificatePem {
  certPem: string
  keyPem: string
  /** Cadeia (certificados intermediários/raiz) em PEM, se presentes. */
  chainPem: string[]
}

/** Extrai certificado + chave privada em PEM para assinatura (US4). */
export function loadCertificateForSigning(pfxBase64: string, password: string): CertificatePem {
  const p12 = openPkcs12(pfxBase64, password)
  const certBags = p12.getBags({ bagType: CERT_BAG })[CERT_BAG] ?? []
  const keyBags = p12.getBags({ bagType: KEY_BAG })[KEY_BAG] ?? []
  const leaf = certBags[0]?.cert
  const key = keyBags[0]?.key
  if (!leaf || !key) {
    throw new TissInvalidCertificateError('Certificado A1 sem chave privada utilizável.')
  }
  const certPem = forge.pki.certificateToPem(leaf)
  const keyPem = forge.pki.privateKeyToPem(key)
  const chainPem = certBags
    .slice(1)
    .map((b: forge.pkcs12.Bag) => (b.cert ? forge.pki.certificateToPem(b.cert) : ''))
    .filter(Boolean)
  return { certPem, keyPem, chainPem }
}

/**
 * Feature 029 (US4/T039) — assinatura XMLDSig do lote TISS.
 *
 * Assinatura ENVELOPED sobre o elemento `mensagemTISS`, RSA-SHA256, com
 * canonicalização exclusiva, usando o certificado ICP-Brasil A1 do tenant.
 * O `<Signature>` é anexado como último filho de `mensagemTISS` (posição exigida
 * pela sequência do XSD: cabecalho → prestador/operadora → epilogo → Signature).
 *
 * ⚠️ PREMISSA (T034 — confirmar no Componente de Segurança e Privacidade ANS
 * 202511): algoritmo de assinatura (RSA-SHA256), digest (SHA-256),
 * canonicalização (exclusiva), e conteúdo do `KeyInfo` (X509Certificate do A1).
 * A 202511 pode exigir cadeia completa no KeyInfo — ponto isolado aqui.
 */
import { SignedXml } from 'xml-crypto'

const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const MENSAGEM_XPATH = "/*[local-name(.)='mensagemTISS']"

export interface SigningCertificate {
  certPem: string
  keyPem: string
}

/** Corpo do certificado PEM (sem cabeçalhos/quebras) para o X509Certificate. */
function certBody(certPem: string): string {
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

/**
 * Assina o XML do lote (`mensagemTISS`) e devolve o XML assinado.
 * O hash MD-5 do epílogo já deve estar preenchido antes de assinar.
 */
export function signLoteXml(xml: string, cert: SigningCertificate): string {
  const sig = new SignedXml({
    privateKey: cert.keyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  })
  // URI="" (assinatura sobre o documento inteiro, enveloped) — evita que o
  // xml-crypto injete um atributo `Id` no `mensagemTISS` (proibido pelo XSD).
  sig.addReference({
    xpath: MENSAGEM_XPATH,
    transforms: [ENVELOPED, EXC_C14N],
    digestAlgorithm: SHA256,
    uri: '',
    isEmptyUri: true,
  })
  // KeyInfo com o certificado A1 (X509). Herda o namespace xmldsig padrão do
  // <Signature>, então não usa prefixo aqui.
  sig.getKeyInfoContent = () =>
    `<X509Data><X509Certificate>${certBody(cert.certPem)}</X509Certificate></X509Data>`
  sig.computeSignature(xml, {
    location: { reference: MENSAGEM_XPATH, action: 'append' },
  })
  return sig.getSignedXml()
}

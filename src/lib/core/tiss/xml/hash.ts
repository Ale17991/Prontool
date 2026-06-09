/**
 * Feature 029 (US4/T037) — hash MD-5 do epílogo da mensagem TISS.
 *
 * ⚠️ PREMISSA (T034 — confirmar no Componente de Segurança e Privacidade ANS
 * 202511 antes de enviar a uma operadora real): a regra do Padrão TISS
 * (Componente de Comunicação) é:
 *   "concatenar o CONTEÚDO de todos os campos da mensagem (somente os valores,
 *    sem as tags), na ordem em que aparecem, EXCETO o próprio campo `hash` e a
 *    assinatura digital; aplicar MD5 sobre o resultado."
 *
 * Implementação adotada:
 *   - opera sobre o XML renderizado SEM `<Signature>` e com `<hash>` vazio;
 *   - remove todas as tags (inclui a declaração `<?xml?>`), mantendo os text
 *     nodes na ordem do documento;
 *   - decodifica entidades XML (o hash é sobre o valor real, não o escapado);
 *   - aplica MD5 e devolve hex minúsculo.
 *
 * Pontos a confirmar na 202511: (a) hex minúsculo vs maiúsculo; (b) se há
 * trim/normalização de espaços; (c) inclusão/exclusão exata de campos. A
 * arquitetura isola a regra aqui — mudança é localizada.
 */
import { createHash } from 'node:crypto'

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&') // por último: evita re-decodificar
}

/**
 * Calcula o hash MD-5 a partir do XML da mensagem renderizado com `<hash>`
 * vazio e SEM assinatura. Retorna hex minúsculo (32 chars).
 */
export function computeTissHashFromXml(xmlWithEmptyHashNoSignature: string): string {
  const textOnly = xmlWithEmptyHashNoSignature.replace(/<[^>]*>/g, '')
  const decoded = decodeXmlEntities(textOnly)
  return createHash('md5').update(decoded, 'utf8').digest('hex')
}

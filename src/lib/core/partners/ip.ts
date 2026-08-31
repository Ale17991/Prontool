/**
 * Faixa de IP permitida por chave de parceiro.
 *
 * Chave vazada é o incidente mais provável de uma integração — vai para um
 * `.env` commitado, um log, um print de tela. A faixa transforma "quem tiver a
 * chave" em "quem tiver a chave E estiver na rede do parceiro", que é uma
 * barreira que o parceiro controla e nós conseguimos verificar.
 *
 * Puro, sem I/O: é decisão de segurança e precisa ser testável linha a linha.
 */

/**
 * Regra vazia é AUSÊNCIA de restrição; array vazio é restrição que não permite
 * nada. Confundir os dois é o erro clássico de allowlist — e a versão perigosa
 * é a que libera. Aqui, `null`/`undefined` libera (a chave não pediu faixa) e
 * `[]` bloqueia (alguém pediu faixa e não configurou nenhuma).
 */
export function ipPermitido(ip: string | null, faixas: string[] | null | undefined): boolean {
  if (faixas === null || faixas === undefined) return true
  if (faixas.length === 0) return false
  if (!ip) return false

  const alvo = normalizar(ip)
  return faixas.some((f) => casa(alvo, f.trim()))
}

/**
 * IPv4 mapeado em IPv6 (`::ffff:203.0.113.7`) volta a ser IPv4.
 *
 * O proxy da Vercel entrega nessa forma em parte das requisições, e sem isto
 * uma faixa IPv4 corretamente cadastrada recusaria o parceiro de forma
 * intermitente — o pior tipo de falha de rede para diagnosticar.
 */
function normalizar(ip: string): string {
  const limpo = ip.trim().toLowerCase()
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpo)
  return m ? m[1]! : limpo
}

function casa(ip: string, faixa: string): boolean {
  if (!faixa) return false
  if (!faixa.includes('/')) return normalizar(faixa) === ip

  const [rede, bitsRaw] = faixa.split('/')
  const bits = Number(bitsRaw)
  if (!rede || !Number.isInteger(bits) || bits < 0 || bits > 32) return false

  const a = paraInt32(ip)
  const b = paraInt32(normalizar(rede))
  if (a === null || b === null) return false

  // `/0` casaria com tudo; deslocar 32 em JS é deslocar 0 (o operador usa só os
  // 5 bits baixos), então uma máscara ingênua para /0 viraria ~0 e liberaria a
  // internet inteira. Tratamos o caso à parte em vez de confiar no operador.
  if (bits === 0) return true
  const mascara = (0xffffffff << (32 - bits)) >>> 0
  return (a & mascara) >>> 0 === (b & mascara) >>> 0
}

function paraInt32(ip: string): number | null {
  const partes = ip.split('.')
  if (partes.length !== 4) return null
  let out = 0
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    out = ((out << 8) | n) >>> 0
  }
  return out >>> 0
}

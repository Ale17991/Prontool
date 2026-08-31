import { describe, expect, it } from 'vitest'
import { ipPermitido } from '@/lib/core/partners/ip'

/**
 * Faixa de IP da chave de parceiro. É controle de segurança: cada caso aqui é
 * uma porta que fica aberta se a lógica errar.
 */

describe('ipPermitido', () => {
  it('sem regra, libera — a chave não pediu restrição', () => {
    expect(ipPermitido('203.0.113.7', null)).toBe(true)
    expect(ipPermitido('203.0.113.7', undefined)).toBe(true)
    expect(ipPermitido(null, null)).toBe(true)
  })

  it('regra VAZIA bloqueia tudo — não é o mesmo que ausência de regra', () => {
    // O erro clássico de allowlist é tratar [] como "sem restrição". A versão
    // perigosa é a que libera; esta recusa.
    expect(ipPermitido('203.0.113.7', [])).toBe(false)
  })

  it('com regra e sem IP conhecido, recusa', () => {
    expect(ipPermitido(null, ['203.0.113.7'])).toBe(false)
  })

  it('casa IP exato', () => {
    expect(ipPermitido('203.0.113.7', ['203.0.113.7'])).toBe(true)
    expect(ipPermitido('203.0.113.8', ['203.0.113.7'])).toBe(false)
  })

  it('casa faixa CIDR', () => {
    expect(ipPermitido('198.51.100.42', ['198.51.100.0/24'])).toBe(true)
    expect(ipPermitido('198.51.101.42', ['198.51.100.0/24'])).toBe(false)
  })

  it('/32 é um endereço só', () => {
    expect(ipPermitido('198.51.100.42', ['198.51.100.42/32'])).toBe(true)
    expect(ipPermitido('198.51.100.43', ['198.51.100.42/32'])).toBe(false)
  })

  it('/0 libera tudo — e o deslocamento de 32 bits não pode quebrar isso', () => {
    // `0xffffffff << 32` em JS é `0xffffffff` (o operador usa 5 bits), então
    // uma máscara ingênua para /0 liberaria a internet por acidente em vez de
    // por decisão. Aqui é por decisão.
    expect(ipPermitido('8.8.8.8', ['0.0.0.0/0'])).toBe(true)
  })

  it('aceita qualquer uma das faixas listadas', () => {
    const faixas = ['203.0.113.7', '198.51.100.0/24']
    expect(ipPermitido('203.0.113.7', faixas)).toBe(true)
    expect(ipPermitido('198.51.100.9', faixas)).toBe(true)
    expect(ipPermitido('192.0.2.1', faixas)).toBe(false)
  })

  it('IPv4 mapeado em IPv6 casa a faixa IPv4', () => {
    // O proxy entrega nessa forma em parte das requisições; sem normalizar, a
    // recusa seria intermitente — o pior tipo de falha de rede.
    expect(ipPermitido('::ffff:198.51.100.42', ['198.51.100.0/24'])).toBe(true)
  })

  it('recusa entrada malformada em vez de deixar passar', () => {
    expect(ipPermitido('nao-e-ip', ['198.51.100.0/24'])).toBe(false)
    expect(ipPermitido('198.51.100.42', ['198.51.100.0/99'])).toBe(false)
    expect(ipPermitido('198.51.100.42', ['999.1.1.1'])).toBe(false)
    expect(ipPermitido('198.51.100.42', [''])).toBe(false)
  })

  it('tolera espaço em volta da faixa cadastrada', () => {
    expect(ipPermitido('203.0.113.7', [' 203.0.113.7 '])).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { parseApiKey } from '@/lib/core/partners/api-keys'
import { PARTNER_SCOPES, SCOPE_LABEL } from '@/lib/core/partners/scopes'

/**
 * Formato da chave de parceiro. Puro: não toca banco nem rede.
 *
 * O parse é a primeira linha de defesa da API de parceiro — o que passa daqui
 * vira consulta ao banco, e o que não passa nem chega lá.
 */

const PREFIX = 'a'.repeat(16)
const SECRET = 'b'.repeat(64)
const VALID = `clinni_${PREFIX}_${SECRET}`

describe('parseApiKey', () => {
  it('aceita a chave no formato emitido', () => {
    expect(parseApiKey(VALID)).toEqual({ prefix: PREFIX, secret: SECRET })
  })

  it('tolera espaço em volta — copiar e colar traz sujeira', () => {
    expect(parseApiKey(`  ${VALID}\n`)).toEqual({ prefix: PREFIX, secret: SECRET })
  })

  it('recusa chave de outro produto', () => {
    expect(parseApiKey(`outro_${PREFIX}_${SECRET}`)).toBeNull()
  })

  it('recusa prefixo ou segredo com tamanho errado', () => {
    expect(parseApiKey(`clinni_${'a'.repeat(15)}_${SECRET}`)).toBeNull()
    expect(parseApiKey(`clinni_${PREFIX}_${'b'.repeat(63)}`)).toBeNull()
  })

  it('recusa caractere fora de hexadecimal', () => {
    expect(parseApiKey(`clinni_${'z'.repeat(16)}_${SECRET}`)).toBeNull()
  })

  it('recusa partes a mais ou a menos', () => {
    expect(parseApiKey(`clinni_${PREFIX}`)).toBeNull()
    expect(parseApiKey(`clinni_${PREFIX}_${SECRET}_extra`)).toBeNull()
    expect(parseApiKey('')).toBeNull()
  })

  it('recusa parte vazia — split devolve string vazia, não undefined', () => {
    expect(parseApiKey('clinni__')).toBeNull()
  })
})

describe('escopos', () => {
  it('todo escopo declarado tem rótulo em português para a tela do /admin', () => {
    for (const s of PARTNER_SCOPES) {
      expect(SCOPE_LABEL[s]).toBeTruthy()
    }
  })

  it('não existe escopo curinga — chave sem escopo não lê nada', () => {
    expect(PARTNER_SCOPES).not.toContain('*')
    expect((PARTNER_SCOPES as readonly string[]).some((s) => s.includes('*'))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { CAMPOS_GHL, chaveDeCampo } from '@/lib/core/support-tickets/crm'

/**
 * Comparação de nome de campo personalizado do GHL.
 *
 * O nome é digitado por gente numa tela, e a comparação exata quebrava por
 * diferença invisível — foi o que fez os 6 campos "não existirem" mesmo tendo
 * sido criados. Cada caso aqui é uma forma legítima de escrever a mesma coisa.
 */
describe('chaveDeCampo', () => {
  it('ignora acento', () => {
    expect(chaveDeCampo('Clinni Situação')).toBe(chaveDeCampo('Clinni Situacao'))
    expect(chaveDeCampo('Clinni Último contato')).toBe(chaveDeCampo('Clinni Ultimo contato'))
  })

  it('ignora caixa', () => {
    expect(chaveDeCampo('Clinni ID')).toBe(chaveDeCampo('clinni id'))
  })

  it('ignora separador — hífen, underscore, espaço a mais', () => {
    const alvo = chaveDeCampo('Clinni Plano')
    expect(chaveDeCampo('Clinni - Plano')).toBe(alvo)
    expect(chaveDeCampo('clinni_plano')).toBe(alvo)
    expect(chaveDeCampo('  Clinni   Plano  ')).toBe(alvo)
  })

  it('NÃO confunde campos diferentes', () => {
    const chaves = Object.values(CAMPOS_GHL).map(chaveDeCampo)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(chaveDeCampo('Clinni ID')).not.toBe(chaveDeCampo('Clinni Slug'))
  })

  it('todo campo esperado gera chave não vazia', () => {
    for (const nome of Object.values(CAMPOS_GHL)) {
      expect(chaveDeCampo(nome).length).toBeGreaterThan(0)
    }
  })
})

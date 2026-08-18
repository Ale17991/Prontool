/**
 * Redefinição de senha self-service — as partes puras (sem DB, sem rede).
 *
 * O que este arquivo protege é a chave do teto por caixa. O limite por e-mail
 * é o que impede transformar a tela pública num bombardeador de caixa de
 * entrada, e ele vale exatamente na medida em que endereços equivalentes caem
 * no MESMO balde. Sem a normalização, trocar uma letra para maiúscula rende um
 * balde novo — e o teto de 3 por hora vira infinito sem ninguém perceber, já
 * que a tela responde a mesma coisa nos dois casos.
 */
import { describe, it, expect } from 'vitest'
import { normalizeEmail, hashPasswordResetSubject } from '@/lib/core/auth/password-reset'

describe('normalizeEmail', () => {
  it('derruba caixa alta e espaços das bordas', () => {
    expect(normalizeEmail('  Ana@Clinica.COM.BR ')).toBe('ana@clinica.com.br')
  })

  it('deixa o endereço já normalizado intacto', () => {
    expect(normalizeEmail('ana@clinica.com.br')).toBe('ana@clinica.com.br')
  })
})

describe('hashPasswordResetSubject', () => {
  it('grafias equivalentes do mesmo e-mail caem no mesmo balde', () => {
    const a = hashPasswordResetSubject('email', normalizeEmail('Ana@Clinica.com'))
    const b = hashPasswordResetSubject('email', normalizeEmail('  ana@clinica.com  '))
    expect(a).toBe(b)
  })

  it('e-mails diferentes não colidem', () => {
    const a = hashPasswordResetSubject('email', 'ana@clinica.com')
    const b = hashPasswordResetSubject('email', 'bia@clinica.com')
    expect(a).not.toBe(b)
  })

  it('nunca devolve o valor em claro', () => {
    const h = hashPasswordResetSubject('email', 'ana@clinica.com')
    expect(h).not.toContain('ana')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('o mesmo texto como e-mail e como IP não colide', () => {
    // O prefixo existe para isso: as duas contagens dividem coluna em consultas
    // distintas, e um valor que servisse aos dois espaços misturaria os tetos.
    expect(hashPasswordResetSubject('email', '10.0.0.1')).not.toBe(
      hashPasswordResetSubject('ip', '10.0.0.1'),
    )
  })
})

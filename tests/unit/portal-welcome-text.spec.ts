/**
 * Feature 057 (T012) — normalização do recado de boas-vindas do portal.
 *
 * "Apagou o texto" e "nunca escreveu" precisam ser o MESMO estado. Guardar `''`
 * criaria um terceiro: indistinguível na leitura, distinguível no banco, e
 * visível meses depois num relatório que conta clínicas "com recado".
 */
import { describe, it, expect } from 'vitest'
import { PatientPortalConfigUpdateSchema } from '@/lib/core/patient-portal/portal-config'

const base = { patientPortalEnabled: true, publicBookingSlug: 'clinica-teste' }

const parse = (welcomeText: unknown) =>
  PatientPortalConfigUpdateSchema.safeParse({ ...base, welcomeText })

describe('Feature 057 — texto de boas-vindas', () => {
  it('mantém o texto escrito, sem espaços nas pontas', () => {
    const res = parse('  Que bom ter você aqui!  ')
    expect(res.success).toBe(true)
    expect(res.success && res.data.welcomeText).toBe('Que bom ter você aqui!')
  })

  it('string vazia vira null', () => {
    const res = parse('')
    expect(res.success).toBe(true)
    expect(res.success && res.data.welcomeText).toBeNull()
  })

  it('só espaços vira null', () => {
    const res = parse('   \n  ')
    expect(res.success).toBe(true)
    expect(res.success && res.data.welcomeText).toBeNull()
  })

  it('null continua null', () => {
    const res = parse(null)
    expect(res.success).toBe(true)
    expect(res.success && res.data.welcomeText).toBeNull()
  })

  it('preserva quebras de linha do meio — o recado pode ter parágrafos', () => {
    const res = parse('Olá!\n\nQualquer dúvida, fale com a recepção.')
    expect(res.success && res.data.welcomeText).toBe(
      'Olá!\n\nQualquer dúvida, fale com a recepção.',
    )
  })

  it('recusa acima de 1.000 caracteres', () => {
    expect(parse('a'.repeat(1001)).success).toBe(false)
    expect(parse('a'.repeat(1000)).success).toBe(true)
  })

  it('ausente = "não mexi nesse campo", e não "apague o recado"', () => {
    // Sem esta distinção, qualquer tela que salvasse só o liga/desliga do portal
    // limparia o texto da clínica sem ninguém ter pedido.
    const res = PatientPortalConfigUpdateSchema.safeParse(base)
    expect(res.success).toBe(true)
    expect(res.success && res.data.welcomeText).toBeUndefined()
  })
})

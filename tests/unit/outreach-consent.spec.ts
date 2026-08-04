/**
 * T019 (Feature 053) — precedência de consentimento.
 *
 * Exigido pela constituição do projeto para funcionalidade que afeta acesso a
 * dado de paciente. Errar aqui manda mensagem para quem recusou, e isso não se
 * desfaz — o paciente não esquece ter recebido o que pediu para não receber.
 *
 * A regra central sob teste: `reminders_opt_in` (lembrete de consulta) NÃO
 * participa desta decisão. São finalidades distintas em LGPD, e aceite dado
 * para uma não vale para a outra.
 */
import { describe, expect, it } from 'vitest'
import { decideConsentAndChannel, type ConsentInput } from '@/lib/core/messaging/consent'

const BASE: ConsentInput = {
  status: 'ativo',
  outreachOptIn: true,
  whatsappOptIn: true,
  phone: '11987654321',
  email: 'maria@exemplo.com',
  preference: 'preferencial',
  whatsappConnected: true,
}

const com = (over: Partial<ConsentInput>): ConsentInput => ({ ...BASE, ...over })

describe('finalidade — o gate de acompanhamento', () => {
  it('sem outreach_opt_in, nada sai, em nenhum canal', () => {
    for (const preference of ['whatsapp', 'email', 'preferencial'] as const) {
      const d = decideConsentAndChannel(com({ outreachOptIn: false, preference }))
      expect(d.ok).toBe(false)
      if (!d.ok) {
        expect(d.reason).toBe('sem_consentimento')
        expect(d.detail).toBe('finalidade')
      }
    }
  })

  it('com outreach_opt_in, sai', () => {
    expect(decideConsentAndChannel(BASE).ok).toBe(true)
  })
})

describe('canal — recusa de WhatsApp cala só o WhatsApp', () => {
  it('paciente que recusou WhatsApp recebe por e-mail no modo preferencial', () => {
    const d = decideConsentAndChannel(com({ whatsappOptIn: false }))
    expect(d).toEqual({ ok: true, channel: 'email' })
  })

  it('recusa de canal é registrada como consentimento, não como indisponibilidade', () => {
    // A distinção importa: colapsar as duas esconderia um número desconectado
    // atrás de "o paciente não quis".
    const d = decideConsentAndChannel(com({ whatsappOptIn: false, preference: 'whatsapp' }))
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.reason).toBe('sem_consentimento')
      expect(d.detail).toBe('canal-whatsapp')
    }
  })

  it('WhatsApp desconectado é indisponibilidade, não recusa', () => {
    const d = decideConsentAndChannel(com({ whatsappConnected: false, preference: 'whatsapp' }))
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('canal_indisponivel')
  })
})

describe('status do cadastro vence tudo', () => {
  it('paciente inativo não recebe, mesmo com todo consentimento', () => {
    const d = decideConsentAndChannel(com({ status: 'inativo' }))
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.detail).toBe('paciente-inativo')
  })

  it('o motivo devolvido é o MAIS fundamental, não o primeiro que aparece', () => {
    // Inativo E sem aceite E sem contato: o motivo é o cadastro, porque mandar
    // a clínica consertar o telefone de quem não deveria receber é desperdício.
    const d = decideConsentAndChannel(
      com({ status: 'arquivado', outreachOptIn: false, phone: null, email: null }),
    )
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.detail).toBe('paciente-inativo')
  })
})

describe('contato', () => {
  it('sem telefone e sem e-mail devolve sem_contato, não canal_indisponivel', () => {
    const d = decideConsentAndChannel(com({ phone: null, email: null }))
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('sem_contato')
  })

  it('telefone inválido não conta como contato de WhatsApp', () => {
    const d = decideConsentAndChannel(com({ phone: '123', email: null, preference: 'whatsapp' }))
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('sem_contato')
  })

  it('só telefone, modo preferencial, vai por WhatsApp', () => {
    expect(decideConsentAndChannel(com({ email: null }))).toEqual({
      ok: true,
      channel: 'whatsapp',
    })
  })

  it('só e-mail, modo preferencial, vai por e-mail', () => {
    expect(decideConsentAndChannel(com({ phone: null }))).toEqual({
      ok: true,
      channel: 'email',
    })
  })

  it('preferência e-mail sem e-mail não cai para WhatsApp — a clínica escolheu', () => {
    const d = decideConsentAndChannel(com({ email: null, preference: 'email' }))
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('canal_indisponivel')
  })
})

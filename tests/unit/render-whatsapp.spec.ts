/**
 * T024 (Feature 051) — renderização do lembrete por WhatsApp (sem DB).
 *
 * O caso que mais importa aqui é o rodapé: o paciente que responde "preciso
 * remarcar" numa caixa que ninguém lê perde a consulta achando que avisou
 * (FR-007a). E a saída não pode conter HTML — o template de e-mail chegaria
 * com as tags literais no celular.
 */
import { describe, it, expect } from 'vitest'
import { renderReminderWhatsApp } from '@/lib/core/reminders/render-whatsapp'
import type { ReminderTemplatePlaceholders } from '@/lib/core/reminders/types'

const P: ReminderTemplatePlaceholders = {
  paciente: 'Maria Silva',
  medico: 'Dr. João Souza',
  procedimento: 'Consulta de retorno',
  horario: 'quinta-feira, 30 de julho de 2026 às 14:30',
  clinica: 'Clínica Exemplo',
}

const base = { template: null, placeholders: P, publicBookingUrl: null, clinicPhone: null }

describe('Feature 051 — renderReminderWhatsApp', () => {
  it('substitui os 5 placeholders', () => {
    const out = renderReminderWhatsApp(base)
    for (const v of Object.values(P)) expect(out).toContain(v)
    expect(out).not.toMatch(/{{\s*\w+\s*}}/)
  })

  it('não emite HTML — o celular mostraria as tags literais', () => {
    const out = renderReminderWhatsApp(base)
    expect(out).not.toMatch(/<[a-z/][^>]*>/i)
    expect(out).not.toContain('&amp;')
    expect(out).not.toContain('&lt;')
  })

  it('não escapa caracteres especiais do nome', () => {
    // No e-mail o `&` vira `&amp;`; aqui isso apareceria cru para o paciente.
    const out = renderReminderWhatsApp({
      ...base,
      placeholders: { ...P, clinica: 'Saúde & Vida' },
    })
    expect(out).toContain('Saúde & Vida')
  })

  it('respeita o template customizado da clínica', () => {
    const out = renderReminderWhatsApp({
      ...base,
      template: 'Oi {{paciente}}, consulta {{horario}}.',
    })
    expect(out).toContain('Oi Maria Silva, consulta quinta-feira')
    expect(out).not.toContain('👋') // o default não vazou
  })
})

describe('Feature 051 — aviso de que respostas não são lidas (FR-007a)', () => {
  it('sempre avisa, mesmo sem nenhum contato configurado', () => {
    expect(renderReminderWhatsApp(base)).toContain('não conseguimos ler respostas')
  })

  it('nível 1: link público de agendamento tem precedência', () => {
    const out = renderReminderWhatsApp({
      ...base,
      publicBookingUrl: 'https://app.exemplo/agendar/clinica',
      clinicPhone: '(11) 3333-4444',
    })
    expect(out).toContain('https://app.exemplo/agendar/clinica')
    expect(out).not.toContain('(11) 3333-4444')
  })

  it('nível 2: sem link, usa o telefone da clínica', () => {
    const out = renderReminderWhatsApp({ ...base, clinicPhone: '(11) 3333-4444' })
    expect(out).toContain('(11) 3333-4444')
  })

  it('nível 3: sem link e sem telefone, orienta genericamente', () => {
    const out = renderReminderWhatsApp(base)
    expect(out).toContain('entre em contato com a clínica')
  })
})

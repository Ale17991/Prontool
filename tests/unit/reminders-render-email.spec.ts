/**
 * T027 (Feature 018) — unit test do renderReminderEmail.
 *
 * Verifica:
 *   - substitui placeholders correctamente
 *   - escapa HTML em CADA valor substituído (defesa XSS)
 *   - usa template default quando custom é null
 *   - inclui footer de cancelamento conforme hierarquia Q3
 */

import { describe, it, expect } from 'vitest'
import { renderReminderEmail } from '@/lib/core/reminders/render-email'

const basePlaceholders = {
  paciente: 'Maria Silva',
  medico: 'Dr. João',
  procedimento: 'Limpeza',
  horario: '20 de maio às 14:00',
  clinica: 'Clínica X',
}

describe('renderReminderEmail', () => {
  it('substitui todos os 5 placeholders no body default', () => {
    const r = renderReminderEmail({
      template: { subject: null, body: null },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: null,
    })
    expect(r.html).toContain('Maria Silva')
    expect(r.html).toContain('Dr. João')
    expect(r.html).toContain('Limpeza')
    expect(r.html).toContain('20 de maio às 14:00')
    expect(r.html).toContain('Clínica X')
    expect(r.html).not.toContain('{{')
  })

  it('substitui placeholder no subject default', () => {
    const r = renderReminderEmail({
      template: { subject: null, body: null },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: null,
    })
    expect(r.subject).toContain('Clínica X')
    expect(r.subject).not.toContain('{{')
  })

  it('aceita template customizado', () => {
    const r = renderReminderEmail({
      template: {
        subject: 'Olá {{paciente}}',
        body: '<p>{{paciente}}, vc tem consulta com {{medico}}</p>',
      },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: null,
    })
    expect(r.subject).toBe('Olá Maria Silva')
    expect(r.html).toContain('Maria Silva, vc tem consulta com Dr. João')
  })

  it('escapa HTML em valor de placeholder (XSS defense)', () => {
    const r = renderReminderEmail({
      template: { subject: 'Hi {{paciente}}', body: '<p>{{paciente}}</p>' },
      placeholders: {
        ...basePlaceholders,
        paciente: '<script>alert("XSS")</script>',
      },
      publicBookingUrl: null,
      clinicPhone: null,
    })
    expect(r.subject).not.toContain('<script>')
    expect(r.subject).toContain('&lt;script&gt;')
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
  })

  it('inclui link de cancelamento se publicBookingUrl fornecido (Q3 nível 2)', () => {
    const r = renderReminderEmail({
      template: { subject: null, body: null },
      placeholders: basePlaceholders,
      publicBookingUrl: 'https://prontool.com.br/agendar/clinica-x',
      clinicPhone: null,
    })
    expect(r.html).toContain('https://prontool.com.br/agendar/clinica-x')
    expect(r.html.toLowerCase()).toContain('cancelar')
  })

  it('inclui telefone como fallback quando publicBookingUrl é null (Q3 nível 3)', () => {
    const r = renderReminderEmail({
      template: { subject: null, body: null },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: '(11) 99999-9999',
    })
    expect(r.html).toContain('(11) 99999-9999')
    expect(r.html.toLowerCase()).toContain('cancelar')
  })

  it('escapa telefone no footer (XSS defense)', () => {
    const r = renderReminderEmail({
      template: { subject: null, body: null },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: '<img src=x onerror=alert(1)>',
    })
    expect(r.html).not.toContain('<img')
    expect(r.html).toContain('&lt;img')
  })

  it('substitui placeholder com espaços {{ paciente }}', () => {
    const r = renderReminderEmail({
      template: { subject: 'Hi {{  paciente  }}', body: 'Body {{ medico }}' },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: null,
    })
    expect(r.subject).toBe('Hi Maria Silva')
    expect(r.html).toContain('Body Dr. João')
  })

  it('placeholder repetido é substituído em todas as ocorrências', () => {
    const r = renderReminderEmail({
      template: {
        subject: '{{clinica}} - {{clinica}}',
        body: '<p>{{paciente}}, {{paciente}}, {{paciente}}</p>',
      },
      placeholders: basePlaceholders,
      publicBookingUrl: null,
      clinicPhone: null,
    })
    expect(r.subject).toBe('Clínica X - Clínica X')
    const occurrences = (r.html.match(/Maria Silva/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(3)
  })
})

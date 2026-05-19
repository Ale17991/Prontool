/**
 * T013 (Feature 018) — unit test do schema Zod de configuração de lembretes.
 *
 * Valida regras de negócio na borda:
 *   - offsets em [0..168] inclusivos; 1..5 itens
 *   - janela end > start
 *   - enabled requer ao menos 1 offset
 *   - templates respeitam tamanho máximo
 */

import { describe, it, expect } from 'vitest'
import { ReminderConfigUpdateSchema } from '@/lib/core/reminders/config'

const baseValid = {
  enabled: true,
  offsetsHours: [24],
  sendWeekends: true,
  windowStart: '08:00',
  windowEnd: '20:00',
  templateSubject: null,
  templateBody: null,
}

describe('ReminderConfigUpdateSchema', () => {
  it('aceita configuração válida default', () => {
    const r = ReminderConfigUpdateSchema.safeParse(baseValid)
    expect(r.success).toBe(true)
  })

  it('aceita múltiplos offsets até 5', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      offsetsHours: [72, 48, 24, 4, 2],
    })
    expect(r.success).toBe(true)
  })

  it('rejeita 0 offsets', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      offsetsHours: [],
    })
    expect(r.success).toBe(false)
  })

  it('rejeita mais de 5 offsets', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      offsetsHours: [1, 2, 3, 4, 5, 6],
    })
    expect(r.success).toBe(false)
  })

  it('rejeita offset negativo', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      offsetsHours: [-1],
    })
    expect(r.success).toBe(false)
  })

  it('rejeita offset acima de 168h (7d)', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      offsetsHours: [200],
    })
    expect(r.success).toBe(false)
  })

  it('rejeita offset não-inteiro', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      offsetsHours: [1.5],
    })
    expect(r.success).toBe(false)
  })

  it('rejeita janela com fim <= início', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      windowStart: '20:00',
      windowEnd: '08:00',
    })
    expect(r.success).toBe(false)
  })

  it('rejeita janela com mesmo horário em ambos', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      windowStart: '12:00',
      windowEnd: '12:00',
    })
    expect(r.success).toBe(false)
  })

  it('rejeita horário sem formato HH:MM', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      windowStart: '8:0',
    })
    expect(r.success).toBe(false)
  })

  it('aceita templates customizados', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      templateSubject: 'Olá {{paciente}}, sua consulta é amanhã',
      templateBody: '<p>Olá {{paciente}}, sua consulta com {{medico}} é em {{horario}}.</p>',
    })
    expect(r.success).toBe(true)
  })

  it('rejeita subject longo demais', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      templateSubject: 'x'.repeat(201),
    })
    expect(r.success).toBe(false)
  })

  it('rejeita body acima de 10k chars', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      templateBody: 'x'.repeat(10_001),
    })
    expect(r.success).toBe(false)
  })

  it('rejeita enabled=true com offsets vazios — refine cruzado', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      enabled: true,
      offsetsHours: [],
    })
    expect(r.success).toBe(false)
  })

  it('aceita enabled=false com offsets vazios (mas .min(1) ainda rejeita)', () => {
    // Mesmo desabilitado o schema exige min 1 offset (para evitar estado inconsistente
    // se admin re-habilitar depois). Default {24} mantém a row sempre válida.
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      enabled: false,
      offsetsHours: [],
    })
    expect(r.success).toBe(false)
  })

  it('aceita enabled=false com offsets default', () => {
    const r = ReminderConfigUpdateSchema.safeParse({
      ...baseValid,
      enabled: false,
      offsetsHours: [24],
    })
    expect(r.success).toBe(true)
  })
})

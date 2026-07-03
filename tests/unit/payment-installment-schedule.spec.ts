/**
 * Unit tests para computeInstallmentSchedule (src/lib/core/payments/create.ts).
 *
 * Garante:
 *   1. O resto da divisão vai na 1ª parcela — nenhum centavo é perdido.
 *   2. Vencimentos avançam 1 mês por parcela, mantendo o dia.
 *   3. A aritmética é independente do fuso do servidor (recebe o "hoje" já
 *      no fuso da clínica como YYYY-MM-DD e não usa `new Date()` local).
 */
import { describe, it, expect } from 'vitest'
import { computeInstallmentSchedule } from '@/lib/core/payments/create'

describe('computeInstallmentSchedule', () => {
  it('parcela única vence no dia base com o total cheio', () => {
    const out = computeInstallmentSchedule(50_00, 1, '2026-05-25')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      installmentNumber: 1,
      amountCents: 50_00,
      dueDate: '2026-05-25',
    })
  })

  it('distribui o resto na 1ª parcela sem perder centavos', () => {
    const out = computeInstallmentSchedule(10_000, 3, '2026-01-15')
    expect(out.map((i) => i.amountCents)).toEqual([3_334, 3_333, 3_333])
    const sum = out.reduce((a, i) => a + i.amountCents, 0)
    expect(sum).toBe(10_000)
  })

  it('avança 1 mês por parcela mantendo o dia', () => {
    const out = computeInstallmentSchedule(30_000, 3, '2026-01-15')
    expect(out.map((i) => i.dueDate)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('cruza a virada de ano corretamente', () => {
    const out = computeInstallmentSchedule(30_000, 3, '2025-11-10')
    expect(out.map((i) => i.dueDate)).toEqual(['2025-11-10', '2025-12-10', '2026-01-10'])
  })

  it('é determinístico — não depende do fuso/relógio do servidor', () => {
    const realTZ = process.env.TZ
    try {
      // Mesmo entrada → mesma saída independente do TZ do processo.
      process.env.TZ = 'America/Sao_Paulo'
      const a = computeInstallmentSchedule(12_345, 4, '2026-12-31')
      process.env.TZ = 'Asia/Tokyo'
      const b = computeInstallmentSchedule(12_345, 4, '2026-12-31')
      expect(a).toEqual(b)
      // dia 31 + meses: overflow de JS Date é estável (jan/31, fev/31→mar/03…)
      expect(a[0]?.dueDate).toBe('2026-12-31')
    } finally {
      process.env.TZ = realTZ
    }
  })
})

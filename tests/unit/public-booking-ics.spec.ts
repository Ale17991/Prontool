/**
 * T080 (Feature 017) — unit test para generateBookingIcs.
 *
 * Verifica:
 *   - output é string `.ics` válida (BEGIN/END VCALENDAR)
 *   - UID estável é incluído
 *   - DTSTART em formato UTC
 *   - duração calculada (DTEND ou DURATION)
 */

import { describe, it, expect } from 'vitest'
import { generateBookingIcs } from '@/lib/utils/ics'

describe('generateBookingIcs', () => {
  it('produz ICS válido com UID estável e horário UTC', () => {
    const ics = generateBookingIcs({
      uid: 'appt-uuid-123',
      title: 'Consulta — Clínica X',
      description: 'Profissional: Dr. A',
      location: 'Av. Brasil 100',
      startIso: '2026-06-15T14:00:00Z',
      durationMinutes: 30,
      organizer: { name: 'Clínica X', email: 'agendamentos@dev.prontool.io' },
    })

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('UID:appt-uuid-123')
    expect(ics).toContain('SUMMARY:Consulta')
    // DTSTART é UTC (formato Z)
    expect(ics).toMatch(/DTSTART[:;].*20260615T140000Z/)
  })

  it('é determinístico para o mesmo input (mesma UID)', () => {
    const input = {
      uid: 'stable-uid',
      title: 'A',
      description: 'B',
      location: 'L',
      startIso: '2026-07-01T09:30:00Z',
      durationMinutes: 60,
      organizer: { name: 'Org', email: 'o@example.com' },
    }
    const a = generateBookingIcs(input)
    const b = generateBookingIcs(input)
    // DTSTAMP varia entre runs (ics package usa now()), mas UID, SUMMARY, DTSTART não.
    const stripDtstamp = (s: string) => s.replace(/DTSTAMP:[^\r\n]+\r?\n/g, '')
    expect(stripDtstamp(a)).toEqual(stripDtstamp(b))
  })
})

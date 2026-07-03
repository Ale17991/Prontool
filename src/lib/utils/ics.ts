/**
 * Feature 017 — Wrapper sobre `ics` para gerar arquivos .ics (RFC 5545).
 *
 * Usado para anexar ao email de confirmação de booking público.
 * UID estável (baseado em appointmentId) permite idempotência caso o
 * cliente de email apresente duplicidade.
 */

import { createEvent, type EventAttributes } from 'ics'

export interface GenerateBookingIcsInput {
  /** ID estável do evento (usamos appointmentId) para retry-safe. */
  uid: string
  title: string
  description: string
  /** Local da consulta (endereço da clínica). */
  location: string
  /** Início em ISO 8601 UTC. */
  startIso: string
  durationMinutes: number
  organizer: {
    name: string
    email: string
  }
}

/**
 * Retorna string `.ics` (texto utf-8). Joga em erro de geração.
 */
export function generateBookingIcs(input: GenerateBookingIcsInput): string {
  const start = new Date(input.startIso)
  const y = start.getUTCFullYear()
  const m = start.getUTCMonth() + 1
  const d = start.getUTCDate()
  const hh = start.getUTCHours()
  const mm = start.getUTCMinutes()

  const event: EventAttributes = {
    uid: input.uid,
    title: input.title,
    description: input.description,
    location: input.location,
    start: [y, m, d, hh, mm],
    startInputType: 'utc',
    startOutputType: 'utc',
    duration: { minutes: input.durationMinutes },
    organizer: { name: input.organizer.name, email: input.organizer.email },
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    productId: 'clinni/public-booking',
  }

  const { error, value } = createEvent(event)
  if (error || !value) {
    throw new Error(`generateBookingIcs failed: ${error?.message ?? 'empty output'}`)
  }
  return value
}

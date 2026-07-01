import { describe, expect, it } from 'vitest'
import { GENERIC_ERROR_MESSAGE, entityToLabel, eventTypeToLabel } from '@/lib/utils/audit-labels'

describe('eventTypeToLabel', () => {
  it('translates known appointment events', () => {
    expect(eventTypeToLabel('appointment.created')).toBe('Atendimento criado')
    expect(eventTypeToLabel('appointment.reversed')).toBe('Cancelamento de atendimento')
    expect(eventTypeToLabel('appointment.realized')).toBe('Atendimento confirmado')
  })

  it('translates feature 007 material event', () => {
    expect(eventTypeToLabel('appointment_material.created')).toBe(
      'Material adicionado ao atendimento',
    )
  })

  it('translates patient events', () => {
    expect(eventTypeToLabel('patient.created')).toBe('Paciente cadastrado')
    expect(eventTypeToLabel('patient.anonymized')).toBe('Paciente anonimizado')
  })

  it('translates integration events', () => {
    expect(eventTypeToLabel('integration.connect')).toBe('Integração conectada')
    expect(eventTypeToLabel('integration_sync_failed')).toBe('Falha de sincronização de integração')
  })

  it('falls back to literal for unknown events', () => {
    expect(eventTypeToLabel('foo.bar')).toBe('foo.bar')
    expect(eventTypeToLabel('something_new')).toBe('something_new')
  })

  it('handles null/undefined', () => {
    expect(eventTypeToLabel(null)).toBe('—')
    expect(eventTypeToLabel(undefined)).toBe('—')
    expect(eventTypeToLabel('')).toBe('—')
  })
})

describe('entityToLabel', () => {
  it('translates known entities', () => {
    expect(entityToLabel('appointments')).toBe('Atendimento')
    expect(entityToLabel('appointment_reversals')).toBe('Cancelamento de atendimento')
    expect(entityToLabel('appointment_materials')).toBe('Material do atendimento')
    expect(entityToLabel('patients')).toBe('Paciente')
  })

  it('falls back for unknown', () => {
    expect(entityToLabel('foo')).toBe('foo')
  })

  it('handles null/undefined', () => {
    expect(entityToLabel(null)).toBe('—')
    expect(entityToLabel(undefined)).toBe('—')
  })
})

describe('GENERIC_ERROR_MESSAGE', () => {
  it('matches the spec FR-021', () => {
    expect(GENERIC_ERROR_MESSAGE).toBe('Algo deu errado. Tente novamente em alguns segundos.')
  })
})

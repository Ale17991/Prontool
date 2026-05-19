/**
 * T014 (Feature 018) — unit test de RBAC para a action `reminders.config`.
 *
 * Valida que apenas admin e recepcionista têm permissão. Profissional de
 * saúde e financeiro são bloqueados.
 *
 * Não chama saveReminderConfig (depende de getSession() e Supabase) — testa
 * só o gate via `can()`.
 */

import { describe, it, expect } from 'vitest'
import { can } from '@/lib/auth/rbac'

describe('RBAC reminders.config', () => {
  it('admin tem acesso', () => {
    expect(can('admin', 'reminders.config')).toBe(true)
  })

  it('recepcionista tem acesso', () => {
    expect(can('recepcionista', 'reminders.config')).toBe(true)
  })

  it('profissional_saude é bloqueado', () => {
    expect(can('profissional_saude', 'reminders.config')).toBe(false)
  })

  it('financeiro é bloqueado', () => {
    expect(can('financeiro', 'reminders.config')).toBe(false)
  })

  it('null retorna false', () => {
    expect(can(null, 'reminders.config')).toBe(false)
  })

  it('undefined retorna false', () => {
    expect(can(undefined, 'reminders.config')).toBe(false)
  })
})

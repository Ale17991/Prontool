/**
 * Feature 043 — permissão efetiva (papel + overrides). Teste puro de `canUser`.
 */
import { describe, expect, it } from 'vitest'
import {
  canUser,
  can,
  isOverridable,
  PROTECTED_ACTIONS,
  type PermissionOverride,
} from '@/lib/auth/rbac'

describe('canUser (Feature 043)', () => {
  it('sem overrides equivale a can()', () => {
    const o: PermissionOverride[] = []
    expect(canUser('recepcionista', o, 'finance.view_values')).toBe(
      can('recepcionista', 'finance.view_values'),
    )
    expect(canUser('admin', o, 'expense.write')).toBe(can('admin', 'expense.write'))
  })

  it('grant adiciona uma ação que o papel não tem', () => {
    const o: PermissionOverride[] = [{ action: 'finance.view_values', effect: 'grant' }]
    expect(can('recepcionista', 'finance.view_values')).toBe(false)
    expect(canUser('recepcionista', o, 'finance.view_values')).toBe(true)
  })

  it('deny remove uma ação do papel (deny vence)', () => {
    const o: PermissionOverride[] = [{ action: 'expense.write', effect: 'deny' }]
    expect(can('admin', 'expense.write')).toBe(true)
    expect(canUser('admin', o, 'expense.write')).toBe(false)
  })

  it('deny vence grant na mesma ação', () => {
    const o: PermissionOverride[] = [
      { action: 'task.write', effect: 'grant' },
      { action: 'task.write', effect: 'deny' },
    ]
    expect(canUser('recepcionista', o, 'task.write')).toBe(false)
  })

  it('ações protegidas IGNORAM overrides (papel decide)', () => {
    for (const a of PROTECTED_ACTIONS) {
      expect(isOverridable(a)).toBe(false)
      // grant não concede a quem o papel não dá
      expect(canUser('recepcionista', [{ action: a, effect: 'grant' }], a)).toBe(
        can('recepcionista', a),
      )
      // deny não tira de quem o papel dá
      expect(canUser('admin', [{ action: a, effect: 'deny' }], a)).toBe(can('admin', a))
    }
  })
})

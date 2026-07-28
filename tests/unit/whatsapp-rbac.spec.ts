/**
 * T016 (Feature 051) — RBAC da action `whatsapp.config`.
 *
 * FR-024: conectar/desconectar o número é admin-only. É deliberadamente MAIS
 * restrito que `reminders.config`, que inclui recepcionista — vincular o número
 * é ato de titularidade da clínica e tem risco de bloqueio do número em jogo.
 *
 * O plano previa um teste de contrato importando as server actions, mas o
 * padrão da casa para action de servidor é testar o gate `can()` (ver
 * `tests/unit/reminders-rbac.spec.ts`, feature 018): a action depende de
 * `getSession()` e do client Supabase, que não existem no ambiente de teste
 * node. O isolamento entre tenants — a outra metade do que aquele teste de
 * contrato cobriria — é verificado contra o banco de verdade em
 * `tests/integration/whatsapp-tenant-isolation.spec.ts`.
 */

import { describe, it, expect } from 'vitest'
import { can } from '@/lib/auth/rbac'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 051 — RBAC whatsapp.config', () => {
  it('admin tem acesso', () => {
    expect(can('admin', 'whatsapp.config')).toBe(true)
  })

  const negados: TenantRole[] = ['financeiro', 'recepcionista', 'profissional_saude']
  it.each(negados)('%s é bloqueado', (role) => {
    expect(can(role, 'whatsapp.config')).toBe(false)
  })

  it('sessão ausente (null/undefined) é bloqueada', () => {
    expect(can(null, 'whatsapp.config')).toBe(false)
    expect(can(undefined, 'whatsapp.config')).toBe(false)
  })

  it('é mais restrito que reminders.config — recepcionista configura lembrete mas não conecta número', () => {
    expect(can('recepcionista', 'reminders.config')).toBe(true)
    expect(can('recepcionista', 'whatsapp.config')).toBe(false)
  })
})

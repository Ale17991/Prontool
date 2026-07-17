/**
 * T016 (Feature 046) — RBAC da rota de avaliação nutricional.
 * POST cria só para admin/profissional_saude; recepcionista/financeiro → 403.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

describe('Feature 046 — RBAC POST avaliação nutricional', () => {
  let tenantId: string
  let patientId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('na-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    patientId = await seedPatient(tenantId)
  })

  for (const role of roles) {
    const expected = role === 'admin' || role === 'profissional_saude' ? 201 : 403
    it(`POST → ${expected} para ${role}`, async () => {
      const { POST } = await import('@/app/api/pacientes/[id]/avaliacao-nutricional/route')
      const res = await POST(
        new Request(`http://localhost/api/pacientes/${patientId}/avaliacao-nutricional`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${users[role]}` },
          body: JSON.stringify({
            assessed_at: '2026-07-17',
            sex: 'M',
            age_years: 30,
            weight_kg: 80,
            height_cm: 180,
            tmb_equation: 'mifflin',
            activity_factor: 1.55,
            macros: { protPct: 30, carbPct: 40, lipPct: 30 },
          }),
        }),
        { params: { id: patientId } },
      )
      expect(res.status).toBe(expected)
    })
  }
})

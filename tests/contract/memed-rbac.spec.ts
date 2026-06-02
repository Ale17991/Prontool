/**
 * T018/T025 (Feature 026) — Matriz RBAC dos endpoints Memed.
 *
 *  - POST/DELETE /api/integracoes/memed          → admin; demais 403
 *  - POST /api/medicos/{id}/memed-prescritor      → admin; demais 403
 *  - GET  /api/medicos/{id}/memed-token           → admin, profissional_saude; demais 403
 *  - GET  /api/atendimentos/{id}/memed-paciente   → admin, profissional_saude; demais 403
 *
 * As rotas que chamam a Memed lançam 424 (não conectado) ANTES de qualquer
 * chamada externa, então o teste de RBAC não bate na Memed: para papéis
 * permitidos basta provar que NÃO recebem 403. Constituição V.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const ROLES: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

describe('Feature 026 — RBAC endpoints Memed', () => {
  let tenantId: string
  let doctorId: string
  const jwt: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('memed-rbac')
    tenantId = t.tenantId
    for (const role of ROLES) {
      const u = await seedUser(tenantId, role)
      jwt[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    doctorId = (await seedDoctor(tenantId)).doctorId
  })

  for (const role of ROLES) {
    const expected = role === 'admin' ? 200 : 403
    it(`POST /api/integracoes/memed → ${expected} para ${role}`, async () => {
      const { POST } = await import('@/app/api/integracoes/memed/route')
      const res = await POST(
        new Request('http://localhost/api/integracoes/memed', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt[role]}` },
          body: JSON.stringify({ environment: 'staging', accept_terms: true }),
        }),
      )
      expect(res.status).toBe(expected)
    })
  }

  for (const role of ROLES) {
    const expected = role === 'admin' ? 200 : 403
    it(`DELETE /api/integracoes/memed → ${expected} para ${role}`, async () => {
      const { DELETE } = await import('@/app/api/integracoes/memed/route')
      const res = await DELETE(
        new Request('http://localhost/api/integracoes/memed', {
          method: 'DELETE',
          headers: { authorization: `Bearer ${jwt[role]}` },
        }),
      )
      expect(res.status).toBe(expected)
    })
  }

  for (const role of ROLES) {
    const forbidden = role !== 'admin'
    it(`POST /api/medicos/{id}/memed-prescritor → ${forbidden ? '403' : 'não-403'} para ${role}`, async () => {
      const { POST } = await import('@/app/api/medicos/[id]/memed-prescritor/route')
      const res = await POST(
        new Request(`http://localhost/api/medicos/${doctorId}/memed-prescritor`, {
          method: 'POST',
          headers: { authorization: `Bearer ${jwt[role]}` },
        }),
        { params: { id: doctorId } },
      )
      if (forbidden) expect(res.status).toBe(403)
      else expect(res.status).not.toBe(403)
    })
  }

  for (const role of ROLES) {
    const allowed = role === 'admin' || role === 'profissional_saude'
    it(`GET /api/medicos/{id}/memed-token → ${allowed ? 'não-403' : '403'} para ${role}`, async () => {
      const { GET } = await import('@/app/api/medicos/[id]/memed-token/route')
      const res = await GET(
        new Request(`http://localhost/api/medicos/${doctorId}/memed-token`, {
          headers: { authorization: `Bearer ${jwt[role]}` },
        }),
        { params: { id: doctorId } },
      )
      if (allowed) expect(res.status).not.toBe(403)
      else expect(res.status).toBe(403)
    })
  }

  for (const role of ROLES) {
    const allowed = role === 'admin' || role === 'profissional_saude'
    const apptId = randomUUID()
    it(`GET /api/atendimentos/{id}/memed-paciente → ${allowed ? 'não-403' : '403'} para ${role}`, async () => {
      const { GET } = await import('@/app/api/atendimentos/[id]/memed-paciente/route')
      const res = await GET(
        new Request(`http://localhost/api/atendimentos/${apptId}/memed-paciente`, {
          headers: { authorization: `Bearer ${jwt[role]}` },
        }),
        { params: { id: apptId } },
      )
      if (allowed) expect(res.status).not.toBe(403)
      else expect(res.status).toBe(403)
    })
  }
})

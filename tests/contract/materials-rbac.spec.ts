/**
 * T013 (Feature 045) — RBAC das rotas de custo de materiais.
 *
 * Matriz (Constituição Princípio V — papéis validados server-side):
 *  - GET  /api/materiais                         → 200 para todos os papéis
 *    operacionais (o seletor do atendimento consulta o catálogo).
 *  - POST /api/materiais                         → 201 admin/financeiro; 403 outros
 *  - PATCH /api/materiais/{id}                   → 200 admin/financeiro; 403 outros
 *  - PATCH /api/atendimentos/{id}/materiais/{rowId}/custo → 200 admin/financeiro; 403 outros
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedAppointment,
  seedHealthPlan,
  seedProcedure,
  seedTussCode,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

describe('Feature 045 — RBAC de custo de materiais', () => {
  let tenantId: string
  let materialId: string
  let appointmentId: string
  let materialRowId: string
  const users: Record<TenantRole, { userId: string; email: string; jwt: string }> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('mat-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = {
        userId: u.userId,
        email: u.email,
        jwt: mintJwt({ userId: u.userId, email: u.email, tenantId, role }),
      }
    }

    const sb = serviceClient()
    const { data: mat, error: matErr } = await sb
      .from('tenant_materials' as never)
      .insert({
        tenant_id: tenantId,
        name: 'Resina RBAC',
        unit_cost_cents: 1000,
        created_by: users.admin.userId,
      } as never)
      .select('id')
      .single()
    if (matErr) throw new Error(`seed material: ${matErr.message}`)
    materialId = (mat as unknown as { id: string }).id

    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010047')
    const procedureId = await seedProcedure(tenantId, '00010047')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    appointmentId = await seedAppointment({
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId,
      patientId,
      commissionId,
      amountCents: 20000,
      commissionBps: 3000,
    })
    const { data: att, error: attErr } = await sb.rpc('attach_materials_to_appointment' as never, {
      p_appointment_id: appointmentId,
      p_materials: [{ material_name: 'Gaze', quantity: 1, unit_cost_cents: 0 }],
      p_actor: users.admin.userId,
    } as never)
    if (attErr) throw new Error(`attach: ${attErr.message}`)
    materialRowId = (att as unknown as { materials: Array<{ id: string }> }).materials[0]!.id
  })

  for (const role of roles) {
    it(`GET /api/materiais → 200 para ${role}`, async () => {
      const { GET } = await import('@/app/api/materiais/route')
      const res = await GET(
        new Request('http://localhost/api/materiais', {
          headers: { authorization: `Bearer ${users[role].jwt}` },
        }),
      )
      expect(res.status).toBe(200)
    })
  }

  for (const role of roles) {
    const expected = role === 'admin' || role === 'financeiro' ? 201 : 403
    it(`POST /api/materiais → ${expected} para ${role}`, async () => {
      const { POST } = await import('@/app/api/materiais/route')
      const res = await POST(
        new Request('http://localhost/api/materiais', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${users[role].jwt}`,
          },
          body: JSON.stringify({ name: `Insumo ${role}`, unit_cost_cents: 500 }),
        }),
      )
      expect(res.status).toBe(expected)
    })
  }

  for (const role of roles) {
    const expected = role === 'admin' || role === 'financeiro' ? 200 : 403
    it(`PATCH /api/materiais/{id} → ${expected} para ${role}`, async () => {
      const { PATCH } = await import('@/app/api/materiais/[id]/route')
      const res = await PATCH(
        new Request(`http://localhost/api/materiais/${materialId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${users[role].jwt}`,
          },
          body: JSON.stringify({ unit_cost_cents: 1100 }),
        }),
        { params: { id: materialId } },
      )
      expect(res.status).toBe(expected)
    })
  }

  for (const role of roles) {
    const expected = role === 'admin' || role === 'financeiro' ? 200 : 403
    it(`PATCH .../materiais/{rowId}/custo → ${expected} para ${role}`, async () => {
      const { PATCH } = await import(
        '@/app/api/atendimentos/[id]/materiais/[materialRowId]/custo/route'
      )
      const res = await PATCH(
        new Request(
          `http://localhost/api/atendimentos/${appointmentId}/materiais/${materialRowId}/custo`,
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${users[role].jwt}`,
            },
            body: JSON.stringify({ unit_cost_cents: 1300, reason: 'ajuste de custo' }),
          },
        ),
        { params: { id: appointmentId, materialRowId } },
      )
      expect(res.status).toBe(expected)
    })
  }
})

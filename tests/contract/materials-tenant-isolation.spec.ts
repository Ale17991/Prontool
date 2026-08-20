/**
 * T012 (Feature 045) — isolamento de tenant no catálogo (`tenant_materials`)
 * e na RPC `set_appointment_material_cost`.
 *
 * - RLS: um usuário do tenant B não SELECIONA nem INSERE insumos no tenant A.
 * - A RPC (SECURITY DEFINER) devolve MATERIAL_ROW_NOT_FOUND quando o
 *   `jwt_tenant_id()` do chamador difere do tenant do material — não vaza a
 *   existência da linha em outra clínica.
 *
 * Constituição Princípio IV: isolamento por `tenant_id` em todo dado.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
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

describe('Feature 045 — tenant isolation (tenant_materials + set_cost)', () => {
  let tenantA: string
  let tenantB: string
  let aJwt: string
  let bJwt: string
  let materialA: string // tenant_materials.id no tenant A
  let materialRowA: string // appointment_materials.id no tenant A

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('mat-iso-a')).tenantId
    tenantB = (await seedTenant('mat-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    aJwt = mintJwt({ userId: adminA.userId, email: adminA.email, tenantId: tenantA, role: 'admin' })
    bJwt = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: tenantB, role: 'admin' })

    const sb = serviceClient()
    const { data: mat, error: matErr } = await sb
      .from('tenant_materials' as never)
      .insert({
        tenant_id: tenantA,
        name: 'Resina composta',
        unit_cost_cents: 1200,
        created_by: adminA.userId,
      } as never)
      .select('id')
      .single()
    if (matErr) throw new Error(`seed material: ${matErr.message}`)
    materialA = (mat as unknown as { id: string }).id

    // Um appointment_material no tenant A para exercitar a RPC de custo.
    const { doctorId, commissionId } = await seedDoctor(tenantA)
    const planId = await seedHealthPlan(tenantA)
    await seedTussCode('00010046')
    const procedureId = await seedProcedure(tenantA, '00010046')
    const priceVersionId = await seedPriceVersion({
      tenantId: tenantA,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantA)
    const appointmentId = await seedAppointment({
      tenantId: tenantA,
      doctorId,
      planId,
      procedureId,
      priceVersionId,
      patientId,
      commissionId,
      amountCents: 20000,
      commissionBps: 3000,
    })
    const { data: att, error: attErr } = await sb.rpc(
      'attach_materials_to_appointment' as never,
      {
        p_appointment_id: appointmentId,
        p_materials: [{ material_name: 'Gaze', quantity: 1, unit_cost_cents: 0 }],
        p_actor: adminA.userId,
      } as never,
    )
    if (attErr) throw new Error(`attach: ${attErr.message}`)
    materialRowA = (att as unknown as { materials: Array<{ id: string }> }).materials[0]!.id
  })

  it('tenant B NÃO enxerga o insumo do tenant A (RLS SELECT)', async () => {
    const rls = rlsClient(bJwt)
    const { data, error } = await rls.from('tenant_materials' as never).select('id')
    expect(error).toBeNull()
    expect((data ?? []).map((r) => (r as { id: string }).id)).not.toContain(materialA)
  })

  it('tenant A enxerga o próprio insumo (controle positivo)', async () => {
    const rls = rlsClient(aJwt)
    const { data, error } = await rls.from('tenant_materials' as never).select('id')
    expect(error).toBeNull()
    expect((data ?? []).map((r) => (r as { id: string }).id)).toContain(materialA)
  })

  it('tenant B NÃO consegue INSERIR insumo no tenant A (RLS WITH CHECK)', async () => {
    const rls = rlsClient(bJwt)
    const { error } = await rls.from('tenant_materials' as never).insert({
      tenant_id: tenantA,
      name: 'Insumo intruso',
      unit_cost_cents: 100,
      created_by: '00000000-0000-0000-0000-000000000000',
    } as never)
    expect(error).toBeTruthy()
  })

  it('set_appointment_material_cost do tenant B sobre linha do A → MATERIAL_ROW_NOT_FOUND', async () => {
    const rls = rlsClient(bJwt)
    const { error } = await rls.rpc(
      'set_appointment_material_cost' as never,
      {
        p_material_row_id: materialRowA,
        p_unit_cost_cents: 9999,
        p_material_id: null,
        p_reason: 'tentativa cross-tenant',
        p_actor: '00000000-0000-0000-0000-000000000000',
      } as never,
    )
    expect(error?.message).toMatch(/MATERIAL_ROW_NOT_FOUND/)
    // Confirma que o custo NÃO mudou.
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_materials' as never)
      .select('unit_cost_cents')
      .eq('id', materialRowA)
      .single()
    expect((data as unknown as { unit_cost_cents: number }).unit_cost_cents).toBe(0)
  })
})

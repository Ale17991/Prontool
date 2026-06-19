/**
 * T008 (Feature 031) — append-only das participações por procedimento.
 *
 * Constitution I: na `appointment_assistants` estendida (0128), UPDATE de
 * `procedure_id`/`participation_degree`/`frozen_amount_cents` é bloqueado;
 * DELETE bloqueado; só `removed_at`/`removed_by` podem mudar (via RPC).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { setupParticipantScenario, type ParticipantScenario } from '@/tests/helpers/participants-setup'

describe('Feature 031 — participantes append-only', () => {
  let s: ParticipantScenario
  let rowId: string

  beforeAll(async () => {
    await resetDatabase()
    s = await setupParticipantScenario('p-append')
    const sb = serviceClient()
    const { data, error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: s.appointmentId,
      p_assistant_doctor_id: s.doctorComissionadoId,
      p_amount_cents: 30000,
      p_actor: s.adminUserId,
      p_procedure_id: s.procedureLineId,
      p_participation_degree: '06',
    } as never)
    if (error) throw new Error(`attach: ${error.message}`)
    rowId = data as unknown as string
  })

  it('UPDATE de frozen_amount_cents é rejeitado (REVOKE/trigger)', async () => {
    const rls = rlsClient(s.adminJwt)
    const { error } = await rls
      .from('appointment_assistants' as never)
      .update({ frozen_amount_cents: 99999 } as never)
      .eq('id', rowId)
    if (error) expect(error.message).toMatch(/permission|denied|policy|append-only|immutable|core/i)
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('frozen_amount_cents')
      .eq('id', rowId)
      .single()
    expect((data as unknown as { frozen_amount_cents: number }).frozen_amount_cents).toBe(30000)
  })

  it('UPDATE de procedure_id/participation_degree via authenticated é rejeitado', async () => {
    // O caminho do app (authenticated) não tem GRANT de UPDATE (REVOKE na 0084)
    // e, mesmo que tivesse, o trigger reforça a imutabilidade dessas colunas na
    // 0128. service_role é confiável e ignora o guard (usado pelas RPCs).
    const rls = rlsClient(s.adminJwt)
    const { error } = await rls
      .from('appointment_assistants' as never)
      .update({ participation_degree: '00' } as never)
      .eq('id', rowId)
    if (error) expect(error.message).toMatch(/permission|denied|policy|append-only|immutable|core/i)
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('participation_degree')
      .eq('id', rowId)
      .single()
    expect((data as unknown as { participation_degree: string }).participation_degree).toBe('06')
  })

  it('DELETE direto via authenticated é rejeitado', async () => {
    const rls = rlsClient(s.adminJwt)
    const { error } = await rls.from('appointment_assistants' as never).delete().eq('id', rowId)
    if (error) expect(error.message).toMatch(/permission|denied|policy|append-only|DELETE/i)
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('id')
      .eq('id', rowId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })

  it('soft-unlink (removed_at/removed_by) via RPC passa; segundo é rejeitado', async () => {
    const sb = serviceClient()
    const ok = await sb.rpc('remove_appointment_assistant', {
      p_id: rowId,
      p_actor: s.adminUserId,
    } as never)
    expect(ok.error).toBeNull()
    const again = await sb.rpc('remove_appointment_assistant', {
      p_id: rowId,
      p_actor: s.adminUserId,
    } as never)
    expect(again.error?.message ?? '').toMatch(/ALREADY_REMOVED/)
  })
})

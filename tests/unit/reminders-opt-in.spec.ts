/**
 * T041 (Feature 018) — unit test do helper de opt-in.
 *
 * Testa apenas a lógica de leitura/atualização do flag. Calls reais para
 * Supabase ficam no integration test (Phase 5 com Docker).
 */

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getPatientOptIn, setPatientOptIn } from '@/lib/core/reminders/opt-in'

function mockSupabaseRead(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eqTenant = vi.fn(() => ({ maybeSingle }))
  const eqId = vi.fn(() => ({ eq: eqTenant }))
  const select = vi.fn(() => ({ eq: eqId }))
  const from = vi.fn(() => ({ select }))
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    spies: { from, select, eqId, eqTenant, maybeSingle },
  }
}

function mockSupabaseUpdate(result: { error: unknown }) {
  const eqTenant = vi.fn().mockResolvedValue(result)
  const eqId = vi.fn(() => ({ eq: eqTenant }))
  const update = vi.fn(() => ({ eq: eqId }))
  const from = vi.fn(() => ({ update }))
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    spies: { from, update, eqId, eqTenant },
  }
}

describe('getPatientOptIn', () => {
  it('retorna true (default) quando coluna é null', async () => {
    const { client } = mockSupabaseRead({
      data: { reminders_opt_in: null },
      error: null,
    })
    const r = await getPatientOptIn(client, 'patient-uuid', 'tenant-uuid')
    expect(r).toBe(true)
  })

  it('retorna true quando flag é true', async () => {
    const { client } = mockSupabaseRead({
      data: { reminders_opt_in: true },
      error: null,
    })
    const r = await getPatientOptIn(client, 'patient-uuid', 'tenant-uuid')
    expect(r).toBe(true)
  })

  it('retorna false quando flag é false', async () => {
    const { client } = mockSupabaseRead({
      data: { reminders_opt_in: false },
      error: null,
    })
    const r = await getPatientOptIn(client, 'patient-uuid', 'tenant-uuid')
    expect(r).toBe(false)
  })

  it('retorna true quando paciente não existe (defesa em profundidade)', async () => {
    const { client } = mockSupabaseRead({ data: null, error: null })
    const r = await getPatientOptIn(client, 'patient-uuid', 'tenant-uuid')
    expect(r).toBe(true)
  })

  it('lança erro em falha de DB', async () => {
    const { client } = mockSupabaseRead({
      data: null,
      error: { message: 'connection lost' },
    })
    await expect(getPatientOptIn(client, 'patient-uuid', 'tenant-uuid')).rejects.toThrow(
      /getPatientOptIn failed/,
    )
  })
})

describe('setPatientOptIn', () => {
  it('atualiza com sucesso', async () => {
    const { client, spies } = mockSupabaseUpdate({ error: null })
    await setPatientOptIn(client, 'patient-uuid', 'tenant-uuid', false)
    expect(spies.from).toHaveBeenCalledWith('patients')
    expect(spies.update).toHaveBeenCalledWith({ reminders_opt_in: false })
    expect(spies.eqId).toHaveBeenCalledWith('id', 'patient-uuid')
    expect(spies.eqTenant).toHaveBeenCalledWith('tenant_id', 'tenant-uuid')
  })

  it('filtra por tenant_id (defesa em profundidade Princípio III)', async () => {
    const { client, spies } = mockSupabaseUpdate({ error: null })
    await setPatientOptIn(client, 'patient-uuid', 'tenant-uuid', true)
    // segundo eq deve ser tenant_id
    expect(spies.eqTenant).toHaveBeenCalledWith('tenant_id', 'tenant-uuid')
  })

  it('lança erro em falha de DB', async () => {
    const { client } = mockSupabaseUpdate({ error: { message: 'rls violation' } })
    await expect(setPatientOptIn(client, 'patient-uuid', 'tenant-uuid', false)).rejects.toThrow(
      /setPatientOptIn failed/,
    )
  })
})

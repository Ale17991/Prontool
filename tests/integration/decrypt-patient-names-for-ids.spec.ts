/**
 * RPC decrypt_patient_names_for_ids (migration 0038):
 *   - retorna só os ids passados (não vaza outros pacientes do tenant)
 *   - respeita tenant_id (não vaza pacientes de outros tenants mesmo
 *     se o caller passar id cross-tenant)
 *   - substitui o nome por '[anonimizado]' quando anonymized_at IS NOT NULL
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'

const DEV_KEY = '0000000000000000000000000000000000000000000000000000000000000000'

async function seedPatient(
  tenantId: string,
  fullName: string,
  opts: { anonymized?: boolean } = {},
): Promise<string> {
  const sb = serviceClient()
  const enc = async (plain: string) => {
    const { data, error } = await sb.rpc('enc_text_with_key', { plain, key: DEV_KEY })
    if (error || !data) throw new Error(`enc_text_with_key failed: ${error?.message}`)
    return data as unknown as string
  }
  const id = randomUUID()
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: `ghl_${randomUUID().slice(0, 8)}`,
      full_name_enc: await enc(fullName),
      cpf_enc: await enc('00000000000'),
      anonymized_at: opts.anonymized ? new Date().toISOString() : null,
    })
    .throwOnError()
  return id
}

describe('RPC decrypt_patient_names_for_ids', () => {
  let tenantA = ''
  let tenantB = ''
  let alice = ''
  let bob = ''
  let carol = ''
  let dave = ''

  beforeAll(async () => {
    await resetDatabase({ wipeCatalog: true })
    tenantA = (await seedTenant('decrypt-rpc-a')).tenantId
    tenantB = (await seedTenant('decrypt-rpc-b')).tenantId
    alice = await seedPatient(tenantA, 'Alice Teste')
    bob = await seedPatient(tenantA, 'Bob Teste')
    carol = await seedPatient(tenantA, 'Carol Teste', { anonymized: true })
    dave = await seedPatient(tenantB, 'Dave Cross-Tenant')
  })

  it('retorna apenas os ids solicitados com nome decriptado', async () => {
    const sb = serviceClient()
    const { data, error } = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: tenantA,
      p_patient_ids: [alice, bob],
      p_key: DEV_KEY,
    })
    expect(error).toBeNull()
    const byId = new Map(((data ?? []) as Array<{ id: string; full_name: string }>).map((r) => [r.id, r.full_name]))
    expect(byId.get(alice)).toBe('Alice Teste')
    expect(byId.get(bob)).toBe('Bob Teste')
    expect(byId.size).toBe(2)
  })

  it('substitui nome por [anonimizado] quando anonymized_at está setado', async () => {
    const sb = serviceClient()
    const { data } = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: tenantA,
      p_patient_ids: [carol],
      p_key: DEV_KEY,
    })
    const row = (data ?? [])[0]
    expect(row?.full_name).toBe('[anonimizado]')
    expect(row?.anonymized_at).not.toBeNull()
  })

  it('filtra por tenant — id de outro tenant não é retornado', async () => {
    const sb = serviceClient()
    const { data } = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: tenantA,
      p_patient_ids: [alice, dave],
      p_key: DEV_KEY,
    })
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toContain(alice)
    expect(ids).not.toContain(dave)
  })

  it('array vazio retorna zero linhas', async () => {
    const sb = serviceClient()
    const { data } = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: tenantA,
      p_patient_ids: [],
      p_key: DEV_KEY,
    })
    expect((data ?? []).length).toBe(0)
  })
})

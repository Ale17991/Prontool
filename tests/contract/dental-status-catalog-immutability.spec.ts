/**
 * Feature 039 (US2) — guardas do catálogo de status (trigger
 * `enforce_dental_status_catalog_guard`): `code` é imutável e status de sistema
 * (`is_system`) não pode ser desativado nem removido.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'

describe('dental_status_catalog — imutabilidade', () => {
  beforeAll(async () => {
    await resetDatabase()
  })

  it('alterar code é rejeitado', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('dental_status_catalog')
      .update({ code: 'caries_renamed' })
      .eq('code', 'caries')
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/imutável|immutable|append|permission|42501/)
  })

  it('desativar status de sistema (none) é rejeitado', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('dental_status_catalog')
      .update({ is_active: false })
      .eq('code', 'none')
    expect(error).not.toBeNull()
  })

  it('remover status de sistema (none) é rejeitado', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('dental_status_catalog').delete().eq('code', 'none')
    expect(error).not.toBeNull()
  })

  it('editar label/cor de um status normal é permitido', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('dental_status_catalog')
      .update({ label: 'Cárie (editada)' })
      .eq('code', 'caries')
    expect(error).toBeNull()
  })
})

/**
 * Feature 039 (US2/FR-010/FR-011) — catálogo é global e read-only para tenants.
 * Usuário autenticado de uma clínica NÃO pode inserir/alterar o catálogo
 * (escrita exclusiva do service-role, acionado pelo super-admin no /admin).
 * Leitura é permitida (paleta do odontograma).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('dental_status_catalog — acesso de escrita restrito', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('admin de tenant não consegue inserir no catálogo global', async () => {
    const t = await seedTenant()
    const admin = await seedUser(t.tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId: t.tenantId, role: 'admin' })
    const sb = rlsClient(jwt)
    const { error } = await sb.from('dental_status_catalog').insert({
      code: 'tenant_hack',
      label: 'Hack',
      color: '#000000',
      scope: 'face',
    })
    expect(error).not.toBeNull()
  })

  it('admin de tenant consegue LER o catálogo (paleta)', async () => {
    const t = await seedTenant()
    const admin = await seedUser(t.tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId: t.tenantId, role: 'admin' })
    const sb = rlsClient(jwt)
    const { data, error } = await sb
      .from('dental_status_catalog')
      .select('code')
      .eq('is_active', true)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })
})

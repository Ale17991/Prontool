/**
 * T024 (Feature 050 US3) — seção `exames` do portal do paciente.
 * Gate em 3 camadas: módulo do plano → override da clínica → cautela clínica
 * (dado sensível nasce desligado).
 */
import { describe, it, expect } from 'vitest'
import { PORTAL_SECTIONS } from '@/lib/core/patient-portal/sections'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'
import {
  listEnabledPortalSections,
  resolvePortalSections,
  setPortalSection,
} from '@/lib/core/patient-portal/sections'

const def = () => PORTAL_SECTIONS.find((s) => s.key === 'exames')!

describe('Feature 050 US3 — definição da seção', () => {
  it('está implementada e exige o módulo exames_lab', () => {
    expect(def().implemented).toBe(true)
    expect(def().requiredModule).toBe('exames_lab')
  })

  it('nasce DESLIGADA e é marcada como sensível', () => {
    // Resultado de exame é dado de saúde sensível: a clínica precisa optar por
    // expor, mesmo tendo o módulo contratado.
    expect(def().defaultEnabled).toBe(false)
    expect(def().sensitivity).toBe('alta')
  })
})

describe('Feature 050 US3 — gate por módulo e override', () => {
  it('sem o módulo, a seção não aparece nem com override ligado', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('portal-exames-off')).tenantId
    const sb = serviceClient()

    // Clínica liga explicitamente, mas não tem o módulo.
    await setPortalSection(sb, tenantId, 'exames', true)

    const semModulo = await resolvePortalSections(sb, tenantId, { hasModule: () => false })
    const exames = semModulo.find((s) => s.key === 'exames')
    expect(exames?.enabled).toBe(false)

    const enabled = await listEnabledPortalSections(sb, tenantId, { hasModule: () => false })
    expect(enabled).not.toContain('exames')
  })

  it('com o módulo, segue desligada até a clínica ligar', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('portal-exames-default')).tenantId
    const sb = serviceClient()
    const hasModule = (m: string) => m === 'exames_lab'

    const antes = await listEnabledPortalSections(sb, tenantId, { hasModule })
    expect(antes).not.toContain('exames')

    await setPortalSection(sb, tenantId, 'exames', true)
    const depois = await listEnabledPortalSections(sb, tenantId, { hasModule })
    expect(depois).toContain('exames')
  })

  it('desligar de volta remove a seção', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('portal-exames-toggle')).tenantId
    const sb = serviceClient()
    const hasModule = (m: string) => m === 'exames_lab'

    await setPortalSection(sb, tenantId, 'exames', true)
    expect(await listEnabledPortalSections(sb, tenantId, { hasModule })).toContain('exames')

    await setPortalSection(sb, tenantId, 'exames', false)
    expect(await listEnabledPortalSections(sb, tenantId, { hasModule })).not.toContain('exames')
  })
})

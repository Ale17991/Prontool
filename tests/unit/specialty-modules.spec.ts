/**
 * Feature 042 — módulos de especialidade (convenio/odonto/oftalmo).
 * Valida o catálogo de módulos e o gating dos hub cards de Configurações.
 */
import { describe, expect, it } from 'vitest'
import { ALL_MODULES, buildEntitlements } from '@/lib/core/entitlements/plans'
import { getVisibleHubCards, type HubCardCtx } from '@/app/(dashboard)/configuracoes/_cards'
import type { FeatureName } from '@/lib/feature-flags'

const FLAGS_ON: Record<FeatureName, boolean> = {
  despesas: true,
  anamnese: true,
  relatorios: true,
  comissoes: true,
}

describe('Catálogo de módulos (Feature 042)', () => {
  it('ALL_MODULES inclui convenio/odonto/oftalmo e NÃO inclui tiss', () => {
    expect(ALL_MODULES).toContain('convenio')
    expect(ALL_MODULES).toContain('odonto')
    expect(ALL_MODULES).toContain('oftalmo')
    expect(ALL_MODULES as readonly string[]).not.toContain('tiss')
  })

  it('legacy libera todos os módulos (grandfather), incl. os 3 novos', () => {
    const ent = buildEntitlements('legacy', [])
    expect(ent.hasModule('convenio')).toBe(true)
    expect(ent.hasModule('odonto')).toBe(true)
    expect(ent.hasModule('oftalmo')).toBe(true)
  })

  it('plano não-legacy só tem os módulos contratados', () => {
    const ent = buildEntitlements('pro', ['convenio'])
    expect(ent.hasModule('convenio')).toBe(true)
    expect(ent.hasModule('odonto')).toBe(false)
    expect(ent.hasModule('oftalmo')).toBe(false)
  })
})

describe('Hub cards de Configurações — gating por convenio', () => {
  const ctx = (modules: Parameters<typeof buildEntitlements>[1]): HubCardCtx => ({
    role: 'admin',
    flags: FLAGS_ON,
    ent: buildEntitlements('pro', modules),
  })

  it('admin SEM convenio não vê o card "Convênios"', () => {
    const ids = getVisibleHubCards(ctx([])).map((c) => c.id)
    expect(ids).not.toContain('convenios')
  })

  it('admin COM convenio vê o card "Convênios"', () => {
    const ids = getVisibleHubCards(ctx(['convenio'])).map((c) => c.id)
    expect(ids).toContain('convenios')
  })
})

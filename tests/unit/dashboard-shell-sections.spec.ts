/**
 * Feature 014 — US1 — matriz role × itens visíveis na sidebar após a
 * reorganização. Garante que:
 *  - admin com todas flags ligadas vê 7 itens (3 + 3 + 1).
 *  - Notificações, Alertas do sistema, Pendências e Auditoria saíram da
 *    sidebar para qualquer role.
 *  - Configurações é o único item da terceira seção e visível para todos.
 */
import { describe, expect, it } from 'vitest'
import {
  SECTIONS,
  getVisibleSections,
  type NavContext,
} from '@/app/(dashboard)/_components/sidebar-sections'
import type { TenantRole } from '@/lib/db/types'
import type { FeatureName } from '@/lib/feature-flags'
import { ALL_MODULES, buildEntitlements } from '@/lib/core/entitlements/plans'

// Acesso total (legacy) para isolar estes testes do gate de plano — aqui
// validamos a matriz role × flags; o gate de entitlement tem testes próprios.
const FULL_ENT = buildEntitlements('legacy', [...ALL_MODULES])

const ALL_FLAGS_ON: Record<FeatureName, boolean> = {
  despesas: true,
  anamnese: true,
  relatorios: true,
  comissoes: true,
}

const ALL_FLAGS_OFF: Record<FeatureName, boolean> = {
  despesas: false,
  anamnese: false,
  relatorios: false,
  comissoes: false,
}

function ctx(role: TenantRole, flags = ALL_FLAGS_ON): NavContext {
  return { role, flags, ent: FULL_ENT }
}

function flatLabels(sections: ReturnType<typeof getVisibleSections>): string[] {
  return sections.flatMap((s) => s.visibleItems.map((it) => it.label))
}

describe('SECTIONS shape (Feature 014 — US1)', () => {
  it('has exactly 3 sections in fixed order: operacao → analise → configuracoes', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['operacao', 'analise', 'configuracoes'])
  })

  it('Operação has exactly 4 items: Agenda, Pacientes, Tarefas, Chat', () => {
    const op = SECTIONS.find((s) => s.id === 'operacao')!
    expect(op.items.map((it) => it.label)).toEqual(['Agenda', 'Pacientes', 'Tarefas', 'Chat'])
  })

  it('Análise lista os itens de relatório + financeiro + Faturamento TISS', () => {
    const an = SECTIONS.find((s) => s.id === 'analise')!
    expect(an.items.map((it) => it.label)).toEqual([
      'Relatórios',
      'Comissões',
      'Dashboard',
      'Contas a Receber',
      'Contas a Pagar',
      'Fluxo de Caixa',
      'Repasse Médico',
      'Despesas',
      'Faturamento TISS',
      'Recebíveis Convênio',
    ])
  })

  it('Configurações has exactly 1 item: Configurações (single button)', () => {
    const cfg = SECTIONS.find((s) => s.id === 'configuracoes')!
    expect(cfg.items).toHaveLength(1)
    expect(cfg.items[0]?.label).toBe('Configurações')
    expect(cfg.items[0]?.href).toBe('/configuracoes')
  })

  it('does NOT contain removed labels in any section', () => {
    const allLabels = SECTIONS.flatMap((s) => s.items.map((it) => it.label))
    for (const removed of [
      'Notificações',
      'Alertas do sistema',
      'Pendências',
      'Auditoria',
      'Clínica',
      'Meu Perfil',
      'Usuários',
      'Procedimentos',
      'Convênios',
      'Profissionais',
      'Modelos de Anamnese',
      'Integrações',
    ]) {
      expect(allLabels).not.toContain(removed)
    }
  })
})

describe('getVisibleSections — role matrix with all flags ON', () => {
  it('admin (legacy, todas as flags) vê todos os itens, incluindo Faturamento TISS', () => {
    const visible = getVisibleSections(ctx('admin'))
    expect(flatLabels(visible)).toEqual([
      'Agenda',
      'Pacientes',
      'Tarefas',
      'Chat',
      'Relatórios',
      'Comissões',
      'Dashboard',
      'Contas a Receber',
      'Contas a Pagar',
      'Fluxo de Caixa',
      'Repasse Médico',
      'Despesas',
      'Faturamento TISS',
      'Recebíveis Convênio',
      'Configurações',
    ])
  })

  it('financeiro vê Análise incl. Faturamento TISS (sem Despesas)', () => {
    const visible = getVisibleSections(ctx('financeiro'))
    const labels = flatLabels(visible)
    expect(labels).toContain('Agenda')
    expect(labels).toContain('Relatórios')
    expect(labels).toContain('Faturamento TISS')
    expect(labels).not.toContain('Despesas')
    expect(labels).toContain('Configurações')
  })

  it('recepcionista não vê Relatórios nem Faturamento TISS', () => {
    const visible = getVisibleSections(ctx('recepcionista'))
    const labels = flatLabels(visible)
    expect(labels).toContain('Agenda')
    expect(labels).not.toContain('Relatórios')
    expect(labels).not.toContain('Faturamento TISS')
    expect(labels).toContain('Configurações')
  })

  it('profissional_saude vê Repasse Médico mas não Faturamento TISS', () => {
    const visible = getVisibleSections(ctx('profissional_saude'))
    const labels = flatLabels(visible)
    expect(labels).toEqual([
      'Agenda',
      'Pacientes',
      'Tarefas',
      'Chat',
      'Repasse Médico',
      'Configurações',
    ])
    expect(labels).not.toContain('Faturamento TISS')
  })
})

describe('getVisibleSections — flags OFF', () => {
  it('with all flags OFF, admin loses Análise items but keeps Operação + Configurações', () => {
    const visible = getVisibleSections(ctx('admin', ALL_FLAGS_OFF))
    const labels = flatLabels(visible)
    expect(labels).toContain('Agenda')
    expect(labels).toContain('Pacientes')
    expect(labels).toContain('Tarefas')
    expect(labels).not.toContain('Relatórios')
    expect(labels).not.toContain('Comissões')
    expect(labels).not.toContain('Despesas')
    expect(labels).toContain('Configurações')
  })

  it('com flags OFF a Análise permanece (itens gated só por entitlement: Dashboard, Contas, Repasse, TISS)', () => {
    const visible = getVisibleSections(ctx('admin', ALL_FLAGS_OFF))
    expect(visible.map((s) => s.id)).toEqual(['operacao', 'analise', 'configuracoes'])
  })
})

describe('Configurações item is always visible', () => {
  const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
  for (const role of roles) {
    it(`role ${role} sees Configurações regardless of flags`, () => {
      const visibleOn = getVisibleSections(ctx(role, ALL_FLAGS_ON))
      const visibleOff = getVisibleSections(ctx(role, ALL_FLAGS_OFF))
      expect(flatLabels(visibleOn)).toContain('Configurações')
      expect(flatLabels(visibleOff)).toContain('Configurações')
    })
  }
})

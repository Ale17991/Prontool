/**
 * Feature 014 — US3 — verifica o contrato do hub /configuracoes:
 *  - INV-1: HUB_CARDS tem exatamente 13 entradas.
 *  - INV-2: Auditoria é SEMPRE o último card.
 *  - INV-3: admin com todas flags-on vê os 13 cards.
 *  - INV-4: roles com permissões mínimas veem pelo menos "Meu Perfil".
 *  - INV-5: cada `card.id` é único.
 *  - Ordem fixa (FR-009): clinica, perfil, usuarios, procedimentos,
 *    convenios, profissionais, modelos-anamnese, agendamento-publico,
 *    portal-paciente, lembretes, google-agenda, integracoes, auditoria.
 */
import { describe, expect, it } from 'vitest'
import {
  HUB_CARDS,
  getVisibleHubCards,
  type HubCardCtx,
} from '@/app/(dashboard)/configuracoes/_cards'
import type { TenantRole } from '@/lib/db/types'
import type { FeatureName } from '@/lib/feature-flags'
import { ALL_MODULES, buildEntitlements } from '@/lib/core/entitlements/plans'

// Acesso total (legacy): isola estes testes do gate de plano (testado à parte).
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

function ctx(role: TenantRole, flags = ALL_FLAGS_ON): HubCardCtx {
  return { role, flags, ent: FULL_ENT }
}

describe('HUB_CARDS — invariantes estruturais', () => {
  it('INV-1: HUB_CARDS.length === 13', () => {
    expect(HUB_CARDS).toHaveLength(13)
  })

  it('INV-2: último card é "auditoria"', () => {
    expect(HUB_CARDS[HUB_CARDS.length - 1]?.id).toBe('auditoria')
  })

  it('FR-009: ordem fixa', () => {
    expect(HUB_CARDS.map((c) => c.id)).toEqual([
      'clinica',
      'perfil',
      'usuarios',
      'procedimentos',
      'convenios',
      'profissionais',
      'modelos-anamnese',
      'agendamento-publico',
      'portal-paciente',
      'lembretes',
      'google-agenda',
      'integracoes',
      'auditoria',
    ])
  })

  it('INV-5: cada card.id é único', () => {
    const ids = HUB_CARDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada card tem href, title, description, icon e show', () => {
    for (const c of HUB_CARDS) {
      expect(c.href).toMatch(/^\/configuracoes/)
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.title.length).toBeLessThanOrEqual(30)
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.description.length).toBeLessThanOrEqual(80)
      expect(typeof c.icon).toBe('object') // lucide-react icons são componentes forwardRef
      expect(typeof c.show).toBe('function')
    }
  })

  it('hrefs apontam para /configuracoes/<algo> (auditoria inclusa, não /analise/...)', () => {
    const auditoria = HUB_CARDS.find((c) => c.id === 'auditoria')
    expect(auditoria?.href).toBe('/configuracoes/auditoria')
  })
})

describe('getVisibleHubCards — matriz role × flags (FR-010)', () => {
  it('INV-3: admin com todas flags ON vê os 13 cards na ordem fixa', () => {
    const visible = getVisibleHubCards(ctx('admin'))
    expect(visible).toHaveLength(13)
    expect(visible.map((c) => c.id)).toEqual([
      'clinica',
      'perfil',
      'usuarios',
      'procedimentos',
      'convenios',
      'profissionais',
      'modelos-anamnese',
      'agendamento-publico',
      'portal-paciente',
      'lembretes',
      'google-agenda',
      'integracoes',
      'auditoria',
    ])
  })

  it('admin com anamnese OFF perde Modelos de Anamnese (mantém os outros 12)', () => {
    const visible = getVisibleHubCards(ctx('admin', { ...ALL_FLAGS_ON, anamnese: false }))
    expect(visible.map((c) => c.id)).not.toContain('modelos-anamnese')
    expect(visible).toHaveLength(12)
    // Auditoria continua sendo o último visível.
    expect(visible[visible.length - 1]?.id).toBe('auditoria')
  })

  it('financeiro vê perfil + procedimentos + convenios + profissionais (sem clinica/usuarios/integracoes/anamnese)', () => {
    const visible = getVisibleHubCards(ctx('financeiro'))
    const ids = visible.map((c) => c.id)
    expect(ids).toContain('perfil')
    expect(ids).toContain('procedimentos')
    expect(ids).toContain('convenios')
    expect(ids).toContain('profissionais')
    expect(ids).not.toContain('clinica')
    expect(ids).not.toContain('usuarios')
    expect(ids).not.toContain('integracoes')
    expect(ids).not.toContain('modelos-anamnese')
  })

  it('recepcionista vê perfil + procedimentos + convenios + profissionais (sem clinica/usuarios/integracoes/auditoria)', () => {
    const visible = getVisibleHubCards(ctx('recepcionista'))
    const ids = visible.map((c) => c.id)
    expect(ids).toContain('perfil')
    expect(ids).toContain('procedimentos')
    expect(ids).toContain('convenios')
    expect(ids).toContain('profissionais')
    expect(ids).not.toContain('clinica')
    expect(ids).not.toContain('usuarios')
    expect(ids).not.toContain('integracoes')
    expect(ids).not.toContain('auditoria')
  })

  it('INV-4: profissional_saude com flags ON vê pelo menos perfil', () => {
    const visible = getVisibleHubCards(ctx('profissional_saude'))
    const ids = visible.map((c) => c.id)
    expect(ids).toContain('perfil')
  })

  it('INV-4 (extremo): profissional_saude com todas flags OFF vê pelo menos perfil', () => {
    const visible = getVisibleHubCards(ctx('profissional_saude', ALL_FLAGS_OFF))
    expect(visible.length).toBeGreaterThanOrEqual(1)
    expect(visible.map((c) => c.id)).toContain('perfil')
  })
})

describe('Auditoria card (FR-011)', () => {
  it('admin (audit.read = true) vê Auditoria', () => {
    const visible = getVisibleHubCards(ctx('admin'))
    expect(visible.map((c) => c.id)).toContain('auditoria')
  })

  it('financeiro (audit.read = false) NÃO vê Auditoria', () => {
    const visible = getVisibleHubCards(ctx('financeiro'))
    expect(visible.map((c) => c.id)).not.toContain('auditoria')
  })

  it('recepcionista (audit.read = false) NÃO vê Auditoria', () => {
    const visible = getVisibleHubCards(ctx('recepcionista'))
    expect(visible.map((c) => c.id)).not.toContain('auditoria')
  })

  it('profissional_saude (audit.read = false) NÃO vê Auditoria', () => {
    const visible = getVisibleHubCards(ctx('profissional_saude'))
    expect(visible.map((c) => c.id)).not.toContain('auditoria')
  })
})

describe('Visibilidade preserva ordem do HUB_CARDS', () => {
  const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
  for (const role of roles) {
    it(`role ${role} — visible cards aparecem na ordem original do HUB_CARDS`, () => {
      const visible = getVisibleHubCards(ctx(role))
      const visibleIndices = visible.map((c) => HUB_CARDS.findIndex((d) => d.id === c.id))
      // strictly ascending
      for (let i = 1; i < visibleIndices.length; i++) {
        expect(visibleIndices[i]).toBeGreaterThan(visibleIndices[i - 1]!)
      }
    })
  }
})

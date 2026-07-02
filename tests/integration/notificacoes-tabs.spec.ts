/**
 * Feature 014 — US2 — verifica a lógica de visibilidade/fallback das abas
 * em /operacao/notificacoes. Testa o algoritmo de resolução de
 * `available`/`active` (sem precisar de DOM ou Next runtime real) ao
 * mockar `getSession` e os componentes de aba.
 *
 * Importante: o teste valida o contrato definido em
 * specs/014-sidebar-config-hub/contracts/notifications-tabs.md
 * (algoritmo de resolução A1–A6 + fallback silencioso A5).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { TenantRole } from '@/lib/db/types'

// vi.mock é içado ao topo; os mocks referenciados nas factories precisam existir
// antes → vi.hoisted (consts `*Mock` normais dariam ReferenceError).
const {
  getSessionMock,
  tabBarMock,
  tabNotificacoesMock,
  tabAlertasMock,
  tabDlqMock,
  redirectMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  tabBarMock: vi.fn(() => null),
  tabNotificacoesMock: vi.fn(() => 'TAB_NOTIFICACOES'),
  tabAlertasMock: vi.fn(() => 'TAB_ALERTAS'),
  tabDlqMock: vi.fn(() => 'TAB_DLQ'),
  redirectMock: vi.fn((dest: string) => {
    throw new Error(`NEXT_REDIRECT ${dest}`)
  }),
}))

vi.mock('@/lib/auth/get-session', () => ({
  getSession: () => getSessionMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  permanentRedirect: redirectMock,
}))

vi.mock('@/app/(dashboard)/operacao/notificacoes/_components/tab-bar', () => ({
  TabBar: tabBarMock,
}))

vi.mock('@/app/(dashboard)/operacao/notificacoes/_components/tab-notificacoes', () => ({
  TabNotificacoes: tabNotificacoesMock,
}))

vi.mock('@/app/(dashboard)/operacao/notificacoes/_components/tab-alertas', () => ({
  TabAlertas: tabAlertasMock,
}))

vi.mock('@/app/(dashboard)/operacao/notificacoes/_components/tab-dlq', () => ({
  TabDlq: tabDlqMock,
}))

import { renderToStaticMarkup } from 'react-dom/server'
import NotificacoesPage from '@/app/(dashboard)/operacao/notificacoes/page'

// A página é um Server Component (JSX). Criar `<TabBar/>` não invoca o mock —
// só renderizar invoca. Renderizamos a árvore já resolvida pelo await para que
// tabBarMock/tab*Mock capturem props e chamadas.
async function renderPage(args: { searchParams: Record<string, string> }): Promise<void> {
  renderToStaticMarkup(await NotificacoesPage(args))
}

function session(role: TenantRole) {
  return {
    userId: 'u-1',
    tenantId: 't-1',
    email: 'x@y.com',
    role,
  }
}

beforeEach(() => {
  getSessionMock.mockReset()
  tabBarMock.mockClear()
  tabNotificacoesMock.mockClear()
  tabAlertasMock.mockClear()
  tabDlqMock.mockClear()
  redirectMock.mockClear()
})

describe('NotificacoesPage — tab bar availability matrix (Feature 014 US2)', () => {
  it('admin (alert.read + dlq.read) sees all 3 tabs', async () => {
    getSessionMock.mockResolvedValue(session('admin'))
    await renderPage({ searchParams: {} })

    expect(tabBarMock).toHaveBeenCalledTimes(1)
    const props = tabBarMock.mock.calls[0]?.[0] as {
      active: string
      available: string[]
    }
    expect(props.available).toEqual(['notificacoes', 'alertas', 'dlq'])
    expect(props.active).toBe('notificacoes') // default sem ?tab
  })

  it('financeiro (alert.read sim, dlq.read sim) sees all 3 tabs', async () => {
    getSessionMock.mockResolvedValue(session('financeiro'))
    await renderPage({ searchParams: {} })

    const props = tabBarMock.mock.calls[0]?.[0] as { available: string[] }
    expect(props.available).toEqual(['notificacoes', 'alertas', 'dlq'])
  })

  it('recepcionista (sem alert.read, sem dlq.read) sees only notificacoes', async () => {
    getSessionMock.mockResolvedValue(session('recepcionista'))
    await renderPage({ searchParams: {} })

    const props = tabBarMock.mock.calls[0]?.[0] as {
      active: string
      available: string[]
    }
    expect(props.available).toEqual(['notificacoes'])
    expect(props.active).toBe('notificacoes')
  })

  it('profissional_saude (sem alert.read, sem dlq.read) sees only notificacoes', async () => {
    getSessionMock.mockResolvedValue(session('profissional_saude'))
    await renderPage({ searchParams: {} })

    const props = tabBarMock.mock.calls[0]?.[0] as { available: string[] }
    expect(props.available).toEqual(['notificacoes'])
  })
})

describe('NotificacoesPage — active tab resolution', () => {
  it('admin ?tab=alertas → active=alertas + renderiza TabAlertas', async () => {
    getSessionMock.mockResolvedValue(session('admin'))
    await renderPage({ searchParams: { tab: 'alertas' } })

    const props = tabBarMock.mock.calls[0]?.[0] as { active: string }
    expect(props.active).toBe('alertas')
    expect(tabAlertasMock).toHaveBeenCalled()
    expect(tabNotificacoesMock).not.toHaveBeenCalled()
    expect(tabDlqMock).not.toHaveBeenCalled()
  })

  it('admin ?tab=dlq → active=dlq + renderiza TabDlq', async () => {
    getSessionMock.mockResolvedValue(session('admin'))
    await renderPage({ searchParams: { tab: 'dlq' } })

    const props = tabBarMock.mock.calls[0]?.[0] as { active: string }
    expect(props.active).toBe('dlq')
    expect(tabDlqMock).toHaveBeenCalled()
    expect(tabNotificacoesMock).not.toHaveBeenCalled()
    expect(tabAlertasMock).not.toHaveBeenCalled()
  })

  it('admin ?tab=notificacoes (default explícito) → active=notificacoes', async () => {
    getSessionMock.mockResolvedValue(session('admin'))
    await renderPage({ searchParams: { tab: 'notificacoes' } })

    const props = tabBarMock.mock.calls[0]?.[0] as { active: string }
    expect(props.active).toBe('notificacoes')
    expect(tabNotificacoesMock).toHaveBeenCalled()
  })
})

describe('NotificacoesPage — silent fallback (FR-006)', () => {
  it('recepcionista ?tab=alertas (sem alert.read) → fallback silencioso para notificacoes', async () => {
    getSessionMock.mockResolvedValue(session('recepcionista'))
    await renderPage({ searchParams: { tab: 'alertas' } })

    const props = tabBarMock.mock.calls[0]?.[0] as {
      active: string
      available: string[]
    }
    expect(props.active).toBe('notificacoes')
    expect(props.available).toEqual(['notificacoes'])
    expect(tabNotificacoesMock).toHaveBeenCalled()
    expect(tabAlertasMock).not.toHaveBeenCalled()
  })

  it('recepcionista ?tab=dlq (sem dlq.read) → fallback silencioso para notificacoes', async () => {
    getSessionMock.mockResolvedValue(session('recepcionista'))
    await renderPage({ searchParams: { tab: 'dlq' } })

    const props = tabBarMock.mock.calls[0]?.[0] as { active: string }
    expect(props.active).toBe('notificacoes')
    expect(tabDlqMock).not.toHaveBeenCalled()
  })

  it('admin ?tab=foo (valor inválido) → fallback silencioso para notificacoes', async () => {
    getSessionMock.mockResolvedValue(session('admin'))
    await renderPage({ searchParams: { tab: 'foo' } })

    const props = tabBarMock.mock.calls[0]?.[0] as { active: string }
    expect(props.active).toBe('notificacoes')
  })
})

describe('NotificacoesPage — auth gate', () => {
  it('sem sessão → redirect para /login', async () => {
    getSessionMock.mockResolvedValue(null)
    await expect(NotificacoesPage({ searchParams: {} })).rejects.toThrow(/NEXT_REDIRECT \/login/)
  })
})

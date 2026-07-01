/**
 * Feature 014 — verifica que rotas legadas continuam respondendo via
 * permanentRedirect (308), preservando query strings, conforme contrato
 * em specs/014-sidebar-config-hub/contracts/routes.md.
 *
 * US2: /operacao/alertas → /operacao/notificacoes?tab=alertas[&…]
 * US2: /operacao/dlq → /operacao/notificacoes?tab=dlq[&…]
 * US3: /analise/auditoria → /configuracoes/auditoria[?…]
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const permanentRedirectMock = vi.fn((dest: string) => {
  throw new Error(`NEXT_PERMANENT_REDIRECT ${dest}`)
})

vi.mock('next/navigation', () => ({
  permanentRedirect: permanentRedirectMock,
  redirect: vi.fn((dest: string) => {
    throw new Error(`NEXT_REDIRECT ${dest}`)
  }),
}))

import LegacyAlertasRedirect from '@/app/(dashboard)/operacao/alertas/page'
import LegacyDlqRedirect from '@/app/(dashboard)/operacao/dlq/page'
import LegacyAuditoriaRedirect from '@/app/(dashboard)/analise/auditoria/page'

function expectRedirectTo(expected: string) {
  expect(permanentRedirectMock).toHaveBeenCalledTimes(1)
  expect(permanentRedirectMock.mock.calls[0]?.[0]).toBe(expected)
}

beforeEach(() => {
  permanentRedirectMock.mockClear()
})

describe('/operacao/alertas → /operacao/notificacoes?tab=alertas (US2)', () => {
  it('redirects without query string', () => {
    expect(() => LegacyAlertasRedirect({ searchParams: {} })).toThrow(/NEXT_PERMANENT_REDIRECT/)
    expectRedirectTo('/operacao/notificacoes?tab=alertas')
  })

  it('preserves ?status=aberto', () => {
    expect(() => LegacyAlertasRedirect({ searchParams: { status: 'aberto' } })).toThrow()
    expectRedirectTo('/operacao/notificacoes?tab=alertas&status=aberto')
  })

  it('preserves multiple query params', () => {
    expect(() =>
      LegacyAlertasRedirect({
        searchParams: { status: 'resolvido', severity: 'warning' },
      }),
    ).toThrow()
    const dest = permanentRedirectMock.mock.calls[0]?.[0] as string
    expect(dest).toContain('/operacao/notificacoes?tab=alertas')
    expect(dest).toContain('status=resolvido')
    expect(dest).toContain('severity=warning')
  })

  it('ignores ?tab= override from incoming URL (always force tab=alertas)', () => {
    expect(() => LegacyAlertasRedirect({ searchParams: { tab: 'dlq' } })).toThrow()
    const dest = permanentRedirectMock.mock.calls[0]?.[0] as string
    expect(dest).toBe('/operacao/notificacoes?tab=alertas')
  })
})

describe('/operacao/dlq → /operacao/notificacoes?tab=dlq (US2)', () => {
  it('redirects without query string', () => {
    expect(() => LegacyDlqRedirect({ searchParams: {} })).toThrow()
    expectRedirectTo('/operacao/notificacoes?tab=dlq')
  })

  it('preserves query strings', () => {
    expect(() => LegacyDlqRedirect({ searchParams: { foo: 'bar' } })).toThrow()
    const dest = permanentRedirectMock.mock.calls[0]?.[0] as string
    expect(dest).toContain('/operacao/notificacoes?tab=dlq')
    expect(dest).toContain('foo=bar')
  })

  it('ignores ?tab= override from incoming URL (always force tab=dlq)', () => {
    expect(() => LegacyDlqRedirect({ searchParams: { tab: 'alertas' } })).toThrow()
    expectRedirectTo('/operacao/notificacoes?tab=dlq')
  })
})

describe('/analise/auditoria → /configuracoes/auditoria (US3)', () => {
  it('redirects without query string', () => {
    expect(() => LegacyAuditoriaRedirect({ searchParams: {} })).toThrow()
    expectRedirectTo('/configuracoes/auditoria')
  })

  it('preserves filter query strings', () => {
    expect(() =>
      LegacyAuditoriaRedirect({
        searchParams: { from: '2026-01-01', to: '2026-01-31' },
      }),
    ).toThrow()
    const dest = permanentRedirectMock.mock.calls[0]?.[0] as string
    expect(dest).toContain('/configuracoes/auditoria?')
    expect(dest).toContain('from=2026-01-01')
    expect(dest).toContain('to=2026-01-31')
  })
})

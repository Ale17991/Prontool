import { permanentRedirect } from 'next/navigation'

/**
 * Feature 014 — US3 — rota legada. O código da página de auditoria foi
 * fisicamente movido para /configuracoes/auditoria (rota canônica). Esta
 * página vira redirect permanente (308) preservando query strings de
 * filtro (entity, result, from, to, cursor) que o usuário tinha em
 * bookmarks ou links em audit_log.
 */

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>
}

export default function LegacyAuditoriaRedirect({ searchParams }: PageProps) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') qs.set(k, v)
  }
  const query = qs.toString()
  permanentRedirect(query ? `/configuracoes/auditoria?${query}` : '/configuracoes/auditoria')
}

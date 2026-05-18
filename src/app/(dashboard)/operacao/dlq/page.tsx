import { permanentRedirect } from 'next/navigation'

/**
 * Feature 014 — US2 — rota legada. O conteúdo desta página agora vive
 * em /operacao/notificacoes como sub-seção "dlq". Mantemos a URL acessível
 * via 308 (permanent) preservando query strings. ReprocessButton continua
 * neste diretório porque a sub-seção da nova página importa dele.
 */

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>
}

export default function LegacyDlqRedirect({ searchParams }: PageProps) {
  const qs = new URLSearchParams()
  qs.set('tab', 'dlq')
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'tab') continue
    if (typeof v === 'string') qs.set(k, v)
  }
  permanentRedirect(`/operacao/notificacoes?${qs.toString()}`)
}

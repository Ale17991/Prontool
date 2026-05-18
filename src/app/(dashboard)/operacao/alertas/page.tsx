import { permanentRedirect } from 'next/navigation'

/**
 * Feature 014 — US2 — rota legada. O conteúdo desta página agora vive
 * em /operacao/notificacoes como sub-seção "alertas". Mantemos a URL
 * acessível via 308 (permanent) preservando query strings que o usuário
 * tinha (ex.: ?status=aberto). O componente ResolveButton continua
 * neste diretório porque a sub-seção da nova página importa dele.
 */

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>
}

export default function LegacyAlertasRedirect({ searchParams }: PageProps) {
  const qs = new URLSearchParams()
  qs.set('tab', 'alertas')
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'tab') continue
    if (typeof v === 'string') qs.set(k, v)
  }
  permanentRedirect(`/operacao/notificacoes?${qs.toString()}`)
}

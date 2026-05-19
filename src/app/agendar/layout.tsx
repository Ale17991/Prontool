import type { ReactNode } from 'react'

/**
 * Feature 017 — Layout das páginas públicas de agendamento.
 *
 * FORA do route group (dashboard). Sem sidebar, sem checagem de sessão.
 * Visitantes anônimos acessam direto via /agendar/[slug].
 *
 * Aplica design system 016 (tokens HSL via globals.css).
 */
export default function AgendarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">{children}</div>
    </div>
  )
}

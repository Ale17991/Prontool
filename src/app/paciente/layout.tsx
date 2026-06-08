import type { ReactNode } from 'react'

/**
 * Feature 030 — Layout do portal do paciente.
 *
 * FORA do route group (dashboard) — espelha /agendar (feature 017). Sem
 * sidebar, sem sessão de staff; a sessão do PACIENTE (cookie HMAC) é
 * verificada na própria página/endpoint.
 */
export default function PacienteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">{children}</div>
    </div>
  )
}

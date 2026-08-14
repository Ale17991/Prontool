import type { ReactNode } from 'react'

/**
 * Feature 030 — Layout do portal do paciente.
 *
 * FORA do route group (dashboard) — espelha /agendar (feature 017). Sem
 * sidebar, sem sessão de staff; a sessão do PACIENTE (cookie HMAC) é
 * verificada na própria página/endpoint.
 *
 * Feature 058: o fundo saiu de `bg-slate-50` para `bg-background`. A diferença
 * não é de estilo — `slate-50` é um valor, e valor nenhum obedece a tema. É o
 * token que faz a cor escolhida pela clínica (aplicada em `[slug]/layout.tsx`)
 * chegar até aqui.
 */
export default function PacienteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</div>
    </div>
  )
}

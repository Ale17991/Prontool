import type { ReactNode } from 'react'

/**
 * Vazio de uma seção do portal.
 *
 * Página de área aberta sem conteúdo diz de QUEM depende o preenchimento — o
 * paciente não tem o que fazer aqui além de esperar a equipe, e um branco mudo
 * pareceria erro do sistema.
 */
export function PortalEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}

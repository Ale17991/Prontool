import type { ReactNode } from 'react'

/**
 * Feature 032 — cabeçalho do portal do paciente (estilo acolhedor/moderno).
 * Banner com gradiente da marca, logo + nome da clínica, saudação grande.
 * Reusado no login e no painel para identidade consistente.
 */
interface Props {
  clinicName: string
  logoUrl: string | null
  title: string
  subtitle?: string
  /** Conteúdo à direita (ex.: botão sair). */
  right?: ReactNode
}

export function PortalHeader({ clinicName, logoUrl, title, subtitle, right }: Props) {
  return (
    <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/70 p-6 text-white shadow-lg shadow-primary/20 sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-white/5" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt={clinicName} className="h-full w-full object-contain p-1" />
            </span>
          ) : null}
          <p className="truncate text-xs font-semibold uppercase tracking-widest text-white/80">
            {clinicName}
          </p>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="relative mt-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-white/85">{subtitle}</p> : null}
      </div>
    </header>
  )
}

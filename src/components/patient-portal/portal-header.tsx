import type { ReactNode } from 'react'

/**
 * Feature 032 — cabeçalho do portal do paciente.
 * Estilo clean e sério, moderno e acolhedor: cartão branco, logo + nome da
 * clínica discretos, saudação com boa hierarquia. Sem gradiente/ruído.
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
    <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt={clinicName} className="h-full w-full object-contain p-0.5" />
            </span>
          ) : null}
          <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            {clinicName}
          </p>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
    </header>
  )
}

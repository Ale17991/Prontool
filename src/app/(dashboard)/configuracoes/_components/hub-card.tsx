import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { HubCardDef } from '../_cards'

/**
 * Feature 014 — US3 — card individual do hub /configuracoes. Server
 * Component; envolve todo o conteúdo num `<Link>` (área de clique grande).
 * Ícone é decorativo (`aria-hidden`); a info acessível vem do título e
 * descrição. Indicador `aria-label` no link replica o título para SR.
 */

interface Props {
  card: HubCardDef
}

export function HubCard({ card }: Props) {
  const Icon = card.icon
  return (
    <Link
      href={card.href}
      aria-label={card.title}
      className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight text-slate-900">{card.title}</h2>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden="true"
          />
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{card.description}</p>
      </div>
    </Link>
  )
}

import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Feature 014 — US2 — barra de abas server-rendered da página unificada
 * de notificações. Cada aba é um `<Link>` para `/operacao/notificacoes?tab=<id>`;
 * a aba ativa recebe `aria-current="page"` e um estilo distinto. Abas
 * indisponíveis para o usuário simplesmente não aparecem no DOM.
 */

export type TabId = 'notificacoes' | 'alertas' | 'dlq'

interface TabDef {
  id: TabId
  label: string
}

const ALL_TABS: readonly TabDef[] = [
  { id: 'notificacoes', label: 'Notificações' },
  { id: 'alertas', label: 'Alertas do sistema' },
  { id: 'dlq', label: 'Pendências' },
]

interface Props {
  active: TabId
  available: readonly TabId[]
}

export function TabBar({ active, available }: Props) {
  // available pode vir fora de ordem; filtramos ALL_TABS pra preservar
  // a ordem fixa (notificacoes → alertas → dlq).
  const tabs = ALL_TABS.filter((t) => available.includes(t.id))
  if (tabs.length <= 1) return null

  return (
    <nav
      aria-label="Seções de notificações"
      className="flex gap-1 border-b border-slate-200"
    >
      {tabs.map((t) => {
        const isActive = t.id === active
        return (
          <Link
            key={t.id}
            href={`/operacao/notificacoes?tab=${t.id}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

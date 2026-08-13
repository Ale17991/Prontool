import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'

/**
 * Cards de área da home do portal.
 *
 * A home passou a mostrar só o que o paciente ACOMPANHA no dia a dia (metas e
 * hábitos); todo o resto — evolução, atendimentos, orientações, exames, treino,
 * dieta — virou um card que leva à página própria da área. Antes tudo isso vinha
 * empilhado numa rolagem só, que no celular enterrava justamente o que a pessoa
 * abre o portal para fazer.
 *
 * Área ligada pela clínica mas ainda SEM conteúdo aparece apagada e não leva a
 * lugar nenhum: some seria esconder da pessoa que a clínica ofereceu aquilo, e
 * clicar para chegar numa página vazia é um beco. O card diz o que falta e de
 * quem depende.
 */

export interface PortalCard {
  key: string
  label: string
  href: string
  /** Prévia do que tem dentro (só quando há conteúdo). */
  hint: string
  /** Sem conteúdo ainda ⇒ card apagado, sem link. */
  empty: boolean
  /** O que dizer quando está vazio (quem precisa cadastrar). */
  emptyHint: string
  icon: LucideIcon
  /** Cor do quadradinho do ícone — mesmas famílias já usadas no portal. */
  tone: string
}

export function PortalSectionCards({ cards }: { cards: PortalCard[] }) {
  if (cards.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold text-slate-700">Seu acompanhamento</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <SectionCard key={card.key} card={card} />
        ))}
      </div>
    </section>
  )
}

function SectionCard({ card }: { card: PortalCard }) {
  const Icon = card.icon

  const body = (
    <>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          card.empty ? 'bg-slate-100 text-slate-400' : card.tone
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-bold ${
            card.empty ? 'text-slate-400' : 'text-slate-800'
          }`}
        >
          {card.label}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">
          {card.empty ? card.emptyHint : card.hint}
        </span>
      </span>
      {card.empty ? null : (
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
      )}
    </>
  )

  if (card.empty) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4">
        {body}
      </div>
    )
  }

  return (
    <Link
      href={card.href}
      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60"
    >
      {body}
    </Link>
  )
}

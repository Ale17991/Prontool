import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'

/**
 * Cards de área da home do portal.
 *
 * A home passou a mostrar só o que o paciente ACOMPANHA no dia a dia (metas e
 * hábitos); todo o resto virou um card que leva à página própria da área.
 *
 * DOIS FORMATOS, UM COMPONENTE. No celular o card é uma LINHA (ícone à
 * esquerda, texto, seta à direita): largura cheia com altura baixa é o formato
 * natural de lista tocável. No desktop a mesma peça em três colunas viraria uma
 * tira de ~370x72, larga e rasa, que é o que fazia a grade parecer
 * desproporcional. A partir de `sm` ele vira LADRILHO vertical, com o ícone em
 * cima, e as alturas se igualam por `auto-rows-fr`.
 *
 * A seta some no ladrilho de propósito: num card inteiro clicável ela não
 * informa nada e só desequilibra o canto. O afeto de hover faz esse trabalho.
 *
 * Área ligada mas ainda SEM conteúdo aparece apagada e não leva a lugar nenhum:
 * some seria esconder da pessoa que a clínica ofereceu aquilo, e clicar para
 * chegar numa página vazia é um beco. O card diz o que falta e de quem depende.
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
      <h2 className="mb-3 text-sm font-bold text-foreground">Seu acompanhamento</h2>
      <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <SectionCard key={card.key} card={card} />
        ))}
      </div>
    </section>
  )
}

/** Linha no celular, ladrilho no desktop. */
const SHAPE =
  'flex h-full items-center gap-3 rounded-2xl p-4 ' +
  'sm:flex-col sm:items-start sm:justify-start sm:gap-3 sm:p-5'

function SectionCard({ card }: { card: PortalCard }) {
  const Icon = card.icon

  const body = (
    <>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${
          card.empty ? 'bg-muted text-muted-foreground' : card.tone
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 sm:w-full sm:flex-none">
        <span
          className={`block truncate text-sm font-bold sm:text-[15px] ${
            card.empty ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {card.label}
        </span>
        {/* No celular a prévia não pode quebrar a altura da linha; no ladrilho
            ela tem espaço para duas linhas. */}
        <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground sm:whitespace-normal sm:line-clamp-2">
          {card.empty ? card.emptyHint : card.hint}
        </span>
      </span>
      {card.empty ? null : (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground sm:hidden" />
      )}
    </>
  )

  if (card.empty) {
    return (
      <div className={`${SHAPE} border border-dashed border-border bg-card/60`}>{body}</div>
    )
  }

  return (
    <Link
      href={card.href}
      className={`group ${SHAPE} border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md`}
    >
      {body}
    </Link>
  )
}

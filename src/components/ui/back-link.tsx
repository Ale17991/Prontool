import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BackLinkProps {
  /** Destino do retorno — sempre o PAI da página, nunca `history.back()`. */
  href: string
  /** Rótulo do destino, ex.: "Voltar às configurações". */
  children: ReactNode
  className?: string
}

/**
 * O caminho de volta de uma página que não está na sidebar.
 *
 * Existe porque o retorno estava escrito à mão em cada tela que o tinha, em três
 * grafias diferentes (`ArrowLeft` + `slate-500`, `ChevronLeft` + `slate-800`, e
 * uma seta digitada como texto). A consequência não era estética: onde ninguém
 * copiou o bloco, a página simplesmente não tinha volta — e as telas de
 * configuração só são alcançáveis pelo hub, que a sidebar não mostra item a
 * item. Com um componente, a próxima tela nasce com o retorno em vez de
 * depender de alguém lembrar de colar o trecho.
 *
 * O destino é explícito e não `router.back()`: o histórico do navegador leva de
 * volta para de onde a pessoa VEIO, que pode ser um link de suporte ou outra
 * aba do sistema — e o rótulo prometeria um lugar enquanto entregaria outro.
 *
 * Cor em token, não em `slate-*` escrito na mão: é o que permite o mesmo
 * componente servir o portal do paciente, onde a paleta é da clínica (058).
 */
export function BackLink({ href, children, className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
      {children}
    </Link>
  )
}

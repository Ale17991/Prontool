import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// 016 — Badge variants migradas para consumir tokens do design system.
// Variantes core (default/secondary/success/warning/destructive/outline)
// agora usam os tokens HSL via Tailwind theme.extend.
// Adicionadas variantes do sistema (ativo, inativo, nao_listado,
// personalizado, comissionado, fixo, liberal, agendado, pendente,
// cancelado) conforme spec 016 — substituem badges hardcoded espalhados
// pelo codebase.
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        // Core
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-slate-100 text-slate-700',
        success: 'border-transparent bg-success-bg text-success-text',
        warning: 'border-transparent bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]',
        destructive: 'border-transparent bg-[hsl(var(--alert)/0.1)] text-[hsl(var(--alert))]',
        info: 'border-transparent bg-info-bg text-info-text',
        outline: 'text-foreground',
        // 016 — variantes do sistema (cobrem badges genéricos antes diferidos para feature 017)
        ativo: 'border-transparent bg-success-bg text-success-text',
        inativo: 'border-transparent bg-slate-100 text-slate-600',
        nao_listado: 'border-transparent bg-[#FAF5FF] text-[#6B21A8]',
        personalizado: 'border-transparent bg-[#EDE9FE] text-[#5B21B6]',
        comissionado: 'border-transparent bg-success-bg text-success-text',
        fixo: 'border-transparent bg-[#FFF7ED] text-[#9A3412]',
        liberal: 'border-transparent bg-info-bg text-info-text',
        agendado: 'border-transparent bg-info-bg text-info-text',
        pendente: 'border-transparent bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]',
        cancelado: 'border-transparent bg-slate-100 text-slate-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }

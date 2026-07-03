import * as React from 'react'
import {
  Calendar,
  Check,
  CheckCheck,
  Clock,
  RotateCcw,
  UserX,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppointmentStatusVariant =
  | 'agendado'
  | 'confirmado'
  | 'concluido'
  | 'em_atendimento'
  | 'no_show'
  | 'cancelado'
  | 'estornado'

export interface AppointmentStatusBadgeProps {
  variant: AppointmentStatusVariant
  iconOnly?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export interface AppointmentStatusVariantStyle {
  label: string
  Icon: LucideIcon
  /** Classes Tailwind para uso em block/chip ou no proprio badge. */
  className: string
  /** Style inline (padroes listrados que nao podem ser expressos em Tailwind). */
  style?: React.CSSProperties
  showPulseDot?: boolean
}

// 016 — mapping canônico FR-022.
// Tokens consumidos via Tailwind theme.extend (success-bg/success-text,
// info-bg/info-text, warning, alert, muted). Padroes visuais alem da cor:
// no_show = listrado, cancelado = tracejado, em_atendimento = ponto pulsante
// com fallback motion-safe (WCAG 2.3.3).
export const APPOINTMENT_STATUS_STYLES: Record<
  AppointmentStatusVariant,
  AppointmentStatusVariantStyle
> = {
  agendado: {
    label: 'Agendado',
    Icon: Calendar,
    className: 'bg-info-bg text-info-text border-info-bg',
  },
  confirmado: {
    label: 'A Realizar',
    Icon: Check,
    className: 'bg-success-bg text-success-text border-success-bg',
  },
  concluido: {
    label: 'Realizado',
    Icon: CheckCheck,
    className: 'bg-success-bg/60 text-success-text border-success-bg/60',
  },
  em_atendimento: {
    label: 'Em atendimento',
    Icon: Clock,
    className: 'bg-warning/15 text-[hsl(var(--warning-foreground))] border-warning/30',
    showPulseDot: true,
  },
  no_show: {
    label: 'Não compareceu',
    Icon: UserX,
    className: 'bg-muted text-muted-foreground border-muted-foreground/20',
    style: {
      backgroundImage:
        'repeating-linear-gradient(45deg, transparent 0 4px, hsl(var(--muted-foreground) / 0.12) 4px 8px)',
    },
  },
  cancelado: {
    label: 'Cancelado',
    Icon: X,
    className: 'bg-muted text-muted-foreground border-dashed border-muted-foreground/40',
  },
  estornado: {
    label: 'Estornado',
    Icon: RotateCcw,
    className: 'bg-alert/15 text-[hsl(var(--alert))] border-alert/30',
  },
}

export function AppointmentStatusBadge({
  variant,
  iconOnly = false,
  size = 'md',
  className,
}: AppointmentStatusBadgeProps) {
  const config = APPOINTMENT_STATUS_STYLES[variant]
  const { label, Icon, className: variantClass, showPulseDot, style } = config

  const sizeClass =
    size === 'sm' ? 'gap-1 px-1.5 py-0.5 text-[11px]' : 'gap-1.5 px-2 py-0.5 text-[12px]'
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-bold leading-tight',
        sizeClass,
        variantClass,
        className,
      )}
      style={style}
      aria-label={iconOnly ? label : undefined}
    >
      {showPulseDot ? (
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--warning-foreground))]',
            'motion-safe:animate-pulse',
          )}
        />
      ) : null}
      <Icon className={cn(iconSize, 'shrink-0')} aria-hidden="true" />
      {iconOnly ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </span>
  )
}

/**
 * Helper de dominio — converte effectiveStatus (DB / lib/core/appointments)
 * para a variante visual. Aceita strings desconhecidas e cai em 'agendado'
 * como fallback seguro. Estados extras (confirmado, em_atendimento, no_show)
 * ficam disponiveis para evolucao futura sem mudanca no componente.
 *
 * Mapping documentado em research.md §3 e data-model.md §3.
 */
export function effectiveStatusToVariant(
  effectiveStatus: string | null | undefined,
): AppointmentStatusVariant {
  switch (effectiveStatus) {
    case 'agendado':
      return 'agendado'
    case 'ativo':
    case 'realizado':
      return 'concluido'
    case 'cancelado':
      return 'cancelado'
    case 'estornado':
      return 'estornado'
    case 'confirmado':
      return 'confirmado'
    case 'em_atendimento':
      return 'em_atendimento'
    case 'no_show':
      return 'no_show'
    default:
      return 'agendado'
  }
}

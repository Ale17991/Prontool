import { X } from 'lucide-react'
import {
  PATIENT_TAG_COLOR_CLASSES,
  type PatientTagColor,
} from '@/lib/core/patient-tags/palette'
import { cn } from '@/lib/utils'

export interface TagBadgeProps {
  name: string
  color: PatientTagColor
  /** Tamanho compacto pra usar dentro de listas densas. */
  size?: 'sm' | 'md'
  /** Quando definido, mostra um botão X que dispara onRemove. */
  onRemove?: () => void
  className?: string
}

export function TagBadge({ name, color, size = 'md', onRemove, className }: TagBadgeProps) {
  const palette = PATIENT_TAG_COLOR_CLASSES[color]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-semibold',
        palette.badge,
        size === 'sm'
          ? 'px-1.5 py-0 text-[10px]'
          : 'px-2 py-0.5 text-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block rounded-full',
          palette.dot,
          size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
        )}
      />
      <span className="truncate max-w-[140px]">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover tag ${name}`}
          className="ml-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100"
        >
          <X className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        </button>
      ) : null}
    </span>
  )
}

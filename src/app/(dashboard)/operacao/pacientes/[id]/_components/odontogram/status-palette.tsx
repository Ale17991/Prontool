'use client'

import { cn } from '@/lib/utils'
import type { DentalStatusDTO } from '@/lib/core/dental/status-catalog/list'

interface Props {
  statuses: DentalStatusDTO[]
  selectedId: string | null
  onSelect: (status: DentalStatusDTO) => void
  disabled?: boolean
}

/**
 * Paleta de status (modelo "paleta + pintar", FR-004a). Só status ativos.
 * O usuário seleciona um status aqui e depois clica nos dentes/faces.
 */
export function StatusPalette({ statuses, selectedId, onSelect, disabled }: Props) {
  const active = statuses.filter((s) => s.isActive)

  return (
    <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Paleta de status">
      {active.map((s) => {
        const selected = s.id === selectedId
        return (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onSelect(s)}
            title={`${s.label}${s.scope === 'face' ? ' (face)' : s.scope === 'tooth' ? ' (dente)' : ''}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-slate-900 ring-2 ring-slate-900/20'
                : 'border-slate-200 hover:border-slate-400',
            )}
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full border border-black/10"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'

export interface RowAction {
  label: string
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}

/**
 * Menu de ações por linha (kebab ⋮). Substitui os botões soltos: clica nos três
 * pontinhos e escolhe a ação. Self-contained (fecha ao clicar fora / Esc).
 */
export function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Ações"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                a.onClick()
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50 ${
                a.danger ? 'text-destructive' : 'text-slate-700'
              }`}
            >
              <span className={a.danger ? 'text-destructive' : 'text-slate-400'}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

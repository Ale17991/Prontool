'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TenantRole } from '@/lib/db/types'
import { AppointmentDetailPanel } from './appointment-detail-panel'

/**
 * Wrapper Client Component que envolve a árvore da agenda (lista ou
 * calendário). Intercepta cliques em `<a data-appointment-id="UUID">`
 * via event delegation no root.
 *
 * Modificadores respeitam navegação normal:
 *   - middle-click / ctrl-click / meta-click / shift-click / alt-click → abre nova aba
 *   - click esquerdo simples → `preventDefault()` + abre painel
 *
 * Guards de fechamento/troca (Q3 da clarificação + remediação C1):
 *   - se há ação POST em andamento → "Ação em andamento. Cancelar mesmo assim?"
 *   - se há form com dados não salvos → "Descartar alterações não salvas?"
 *   - senão → prossegue silenciosamente.
 */
interface Props {
  role: TenantRole
  children: React.ReactNode
}

export function AppointmentDetailHost({ role, children }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dirtyRef = useRef<boolean>(false)
  const pendingActionRef = useRef<boolean>(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const tryChangeSelection = useCallback((next: string | null) => {
    if (pendingActionRef.current) {
      if (!window.confirm('Ação em andamento. Cancelar mesmo assim?')) return
    } else if (dirtyRef.current) {
      if (!window.confirm('Descartar alterações não salvas?')) return
    }
    dirtyRef.current = false
    pendingActionRef.current = false
    setSelectedId(next)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    function handleClick(event: MouseEvent) {
      // Respeita middle-click, ctrl/cmd/shift/alt-click — navegação normal.
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (!target) return
      const anchor = target.closest('a[data-appointment-id]') as HTMLAnchorElement | null
      if (!anchor) return
      const id = anchor.getAttribute('data-appointment-id')
      if (!id) return

      event.preventDefault()
      tryChangeSelection(id)
    }

    root.addEventListener('click', handleClick)
    return () => {
      root.removeEventListener('click', handleClick)
    }
  }, [tryChangeSelection])

  return (
    <>
      <div ref={rootRef}>{children}</div>
      <AppointmentDetailPanel
        appointmentId={selectedId}
        role={role}
        onOpenChange={(open) => {
          if (!open) tryChangeSelection(null)
        }}
        dirtyRef={dirtyRef}
        pendingActionRef={pendingActionRef}
      />
    </>
  )
}

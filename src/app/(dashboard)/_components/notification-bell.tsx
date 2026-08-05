'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Feature 012 — US2 — sininho na topbar com badge de não lidas.
 *
 * - Sem não lidas: sem badge.
 * - Com tarefa_atrasada: badge vermelho.
 * - Caso contrário: badge azul.
 *
 * Fetch leve em `/api/notificacoes/unread-count` ao montar.
 */
export function NotificationBell() {
  const [count, setCount] = useState(0)
  const [hasOverdue, setHasOverdue] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/notificacoes/unread-count')
        if (!res.ok) return
        const body = (await res.json()) as { count: number; has_overdue: boolean }
        if (!cancelled) {
          setCount(body.count)
          setHasOverdue(body.has_overdue)
        }
      } catch {
        // silencioso
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Link
      href="/operacao/notificacoes"
      className="relative inline-flex rounded-xl bg-secondary p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
      aria-label={count > 0 ? `${count} notificações não lidas` : 'Notificações'}
    >
      <Bell className="h-4 w-4" />
      {count > 0 ? (
        <span
          className={cn(
            'absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white',
            // Laranja da marca no badge de atenção — é o acento, não a primária.
            hasOverdue ? 'bg-destructive' : 'bg-brand',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}

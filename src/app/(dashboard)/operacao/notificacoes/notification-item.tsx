'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Calendar, CheckCircle2, Cake } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NotificationRow } from '@/lib/core/notifications/list'

interface Props {
  notification: NotificationRow
}

const ICON_BY_TYPE = {
  atendimento: Calendar,
  tarefa: CheckCircle2,
  tarefa_atrasada: AlertTriangle,
  aniversarios_mes: Cake,
} as const

const COLOR_BY_TYPE: Record<NotificationRow['type'], string> = {
  atendimento: 'text-blue-600 bg-blue-50',
  tarefa: 'text-emerald-600 bg-emerald-50',
  tarefa_atrasada: 'text-rose-600 bg-rose-50',
  aniversarios_mes: 'text-purple-600 bg-purple-50',
}

export function NotificationItem({ notification: n }: Props) {
  const router = useRouter()
  const [reading, setReading] = useState(false)
  const Icon = ICON_BY_TYPE[n.type]

  async function onClick() {
    if (reading) return
    setReading(true)
    try {
      if (!n.is_read) {
        await fetch(`/api/notificacoes/${n.id}/read`, { method: 'PATCH' })
      }
      // Navega para a referência se houver
      if (n.reference_type === 'appointment' && n.reference_id) {
        router.push(`/operacao/atendimentos/${n.reference_id}`)
      } else if (n.reference_type === 'task') {
        router.push('/operacao/tarefas')
      } else {
        router.refresh()
      }
    } finally {
      setReading(false)
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-start gap-3 px-6 py-4 text-left transition hover:bg-slate-50',
          !n.is_read && 'bg-blue-50/40',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            COLOR_BY_TYPE[n.type],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                'truncate text-sm',
                n.is_read ? 'font-normal text-slate-700' : 'font-bold text-slate-900',
              )}
            >
              {n.title}
            </p>
            {!n.is_read ? (
              <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-blue-600" />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-slate-600">{n.body}</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-400">
            {new Date(n.created_at).toLocaleString('pt-BR')}
          </p>
        </div>
      </button>
    </li>
  )
}

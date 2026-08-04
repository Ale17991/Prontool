'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Bell } from 'lucide-react'
import type { FamilyOption } from './rule-form'

export interface RuleRow {
  id: string
  family: string
  params: Record<string, unknown>
  channel: string
  messageTemplate: string
  silenceDays: number
  active: boolean
}

export function RuleList({
  rules,
  families,
  onChanged,
}: {
  rules: RuleRow[]
  families: FamilyOption[]
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [alvo, setAlvo] = useState<string | null>(null)

  if (rules.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Nenhuma notificação automática ligada ainda.
      </p>
    )
  }

  function desligar(id: string) {
    setAlvo(id)
    startTransition(async () => {
      await fetch(`/api/notificacoes-automaticas/${id}`, { method: 'DELETE' })
      setAlvo(null)
      onChanged()
    })
  }

  return (
    <ul className="space-y-2">
      {rules.map((r) => {
        const f = families.find((x) => x.id === r.family)
        const celebra = f?.nature === 'celebracao'
        return (
          <li
            key={r.id}
            className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                {celebra ? (
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Bell className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                {f?.label ?? r.family}
                {!r.active && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    desligada
                  </span>
                )}
              </p>
              <p className="mt-1 truncate text-xs text-slate-500">{r.messageTemplate}</p>
              <p className="mt-1 text-xs text-slate-400">
                {descreverParametro(r.params)} · {canalLabel(r.channel)} · não repete por{' '}
                {r.silenceDays} dias
              </p>
            </div>
            {r.active && (
              <button
                type="button"
                onClick={() => desligar(r.id)}
                disabled={pending && alvo === r.id}
                className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 disabled:opacity-50"
              >
                {pending && alvo === r.id ? 'Desligando…' : 'Desligar'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function descreverParametro(params: Record<string, unknown>): string {
  if (typeof params.days === 'number') return `depois de ${params.days} dias`
  if (typeof params.months === 'number') return `depois de ${params.months} meses`
  return 'sem parâmetro'
}

function canalLabel(channel: string): string {
  if (channel === 'whatsapp') return 'só WhatsApp'
  if (channel === 'email') return 'só e-mail'
  return 'WhatsApp ou e-mail'
}
